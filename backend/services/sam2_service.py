"""
SAM 2 inference service.

Handles:
  - Single-frame mask prediction (for the preview step)
  - Full-video mask propagation (for the processing step)

Model is loaded as a singleton on first use to avoid reloading weights.
Falls back gracefully if SAM 2 is not installed (returns blank masks).
"""

import os
import io
import logging
import numpy as np
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

CHECKPOINT = os.getenv("SAM2_CHECKPOINT", "./checkpoints/sam2.1_hiera_base_plus.pt")
MODEL_CFG = os.getenv("SAM2_MODEL_CFG", "configs/sam2.1/sam2.1_hiera_b+.yaml")

# Detect device (supports NVIDIA CUDA, Intel XPU for integrated/dedicated GPUs, and CPU)
try:
    import torch
    if torch.cuda.is_available():
        DEVICE = "cuda"
        logger.info(f"SAM 2 will run on NVIDIA GPU: {torch.cuda.get_device_name(0)}")
    else:
        try:
            import intel_extension_for_pytorch as ipex
            if hasattr(torch, "xpu") and torch.xpu.is_available():
                DEVICE = "xpu"
                logger.info("SAM 2 will run on Intel GPU via XPU (Intel Iris Xe / Arc)")
            else:
                DEVICE = "cpu"
        except ImportError:
            DEVICE = "cpu"
            logger.info("SAM 2 will run on CPU. For Intel Iris Xe GPU acceleration, install intel-extension-for-pytorch.")
except ImportError:
    DEVICE = "cpu"
    logger.warning("PyTorch not found. SAM 2 unavailable.")

# Singleton predictors
_image_predictor = None
_video_predictor = None
_sam2_available = None  # None = not checked yet


def _check_sam2() -> bool:
    """Check if SAM 2 is importable."""
    global _sam2_available
    if _sam2_available is None:
        try:
            import sam2  # noqa: F401
            _sam2_available = True
        except ImportError:
            _sam2_available = False
            logger.warning(
                "SAM 2 is not installed. Install with: "
                "pip install git+https://github.com/facebookresearch/sam2.git\n"
                "Running in DEMO MODE — returning blank masks."
            )
    return _sam2_available


def get_image_predictor():
    """Return the singleton SAM 2 image predictor, loading it if needed."""
    global _image_predictor
    if not _check_sam2():
        return None
    if _image_predictor is None:
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        if not os.path.exists(CHECKPOINT):
            raise FileNotFoundError(
                f"SAM 2 checkpoint not found at {CHECKPOINT}. "
                "Download from https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt"
            )
        model = build_sam2(MODEL_CFG, CHECKPOINT, device=DEVICE)
        _image_predictor = SAM2ImagePredictor(model)
        logger.info("SAM 2 image predictor loaded.")
    return _image_predictor


def get_video_predictor():
    """Return the singleton SAM 2 video predictor, loading it if needed."""
    global _video_predictor
    if not _check_sam2():
        return None
    if _video_predictor is None:
        from sam2.build_sam import build_sam2_video_predictor
        if not os.path.exists(CHECKPOINT):
            raise FileNotFoundError(
                f"SAM 2 checkpoint not found at {CHECKPOINT}."
            )
        _video_predictor = build_sam2_video_predictor(MODEL_CFG, CHECKPOINT, device=DEVICE)
        logger.info("SAM 2 video predictor loaded.")
    return _video_predictor


def predict_single_frame(
    frame_path: str,
    points: list,
    labels: list,
    box: list = None
) -> np.ndarray:
    """
    Run SAM 2 on a single frame.

    Args:
        frame_path: Absolute path to the JPEG frame.
        points: [[x, y], ...] — click coordinates in original image space.
        labels: [1, 0, ...] — 1=foreground, 0=background per point.
        box:    [x1, y1, x2, y2] or None — optional bounding box.

    Returns:
        Binary mask as numpy uint8 array (H, W), values 0 or 255.
    """
    predictor = get_image_predictor()
    image = Image.open(frame_path).convert("RGB")
    img_array = np.array(image)

    if predictor is None:
        # Demo mode — return a centred ellipse as fake mask
        mask = _make_demo_mask(img_array.shape[:2], points)
        return mask

    predictor.set_image(img_array)

    kwargs = {"multimask_output": False}
    if points:
        kwargs["point_coords"] = np.array(points)
        kwargs["point_labels"] = np.array(labels)
    if box is not None:
        kwargs["box"] = np.array(box)

    device_type = "cuda" if DEVICE == "cuda" else ("xpu" if DEVICE == "xpu" else "cpu")
    dtype = torch.float16 if DEVICE in ("cuda", "xpu") else torch.bfloat16

    with torch.inference_mode(), torch.autocast(device_type=device_type, dtype=dtype):
        masks, scores, _ = predictor.predict(**kwargs)
        best_mask = masks[np.argmax(scores)]
        return (best_mask > 0).astype(np.uint8) * 255


def predict_video(
    frames_dir: str,
    masks_dir: str,
    prompts_dict: dict,
    finesse_dict: dict,
    session_id: str,
    start_frame: int = 0,
    direction: str = "forward",
    progress_callback=None
):
    """
    Propagate mask across frames starting from start_frame in the specified direction.
    Applies paint strokes and finesse post-processing to each frame's mask.
    """
    predictor = get_video_predictor()
    frame_files = sorted([f for f in os.listdir(frames_dir) if f.endswith(".jpg")])
    total = len(frame_files)

    # Import helpers inline to avoid circular import issues
    from services.finesse_service import apply_finesse
    from routers.mask import draw_strokes_on_mask, Stroke

    if predictor is None:
        # Demo mode — simulate propagation
        keyframes = sorted([int(k) for k in prompts_dict.keys()])

        if direction == "forward":
            frames_to_process = list(range(start_frame, total))
        else:
            frames_to_process = list(range(start_frame, -1, -1))

        for i in frames_to_process:
            fname = frame_files[i]
            img = Image.open(os.path.join(frames_dir, fname))
            h, w = img.size[::-1]

            target_points = []
            target_box = None
            target_strokes = []

            # If current frame has prompts, use them; else interpolate from closest keyframe
            if str(i) in prompts_dict:
                p = prompts_dict[str(i)]
                target_points = p.get("points", [])
                target_box = p.get("box", None)
                target_strokes = [Stroke(**s) for s in p.get("strokes", [])]
            elif keyframes:
                closest_k = min(keyframes, key=lambda k: abs(k - i))
                p = prompts_dict[str(closest_k)]
                # Add drift offset based on distance to make it look like tracking
                offset = (i - closest_k) * 4
                target_points = [[pt[0] + offset, pt[1] + offset] for pt in p.get("points", [])]
                if p.get("box"):
                    b = p["box"]
                    target_box = [b[0] + offset, b[1] + offset, b[2] + offset, b[3] + offset]
                target_strokes = [Stroke(**s) for s in p.get("strokes", [])]

            mask_arr = _make_demo_mask((h, w), target_points)
            if target_strokes:
                mask_arr = draw_strokes_on_mask(mask_arr, target_strokes)

            # Save raw mask
            raw_path = os.path.join(masks_dir, f"raw_{i:05d}.png")
            Image.fromarray(mask_arr).save(raw_path)

            # Apply finesse and save finessed mask
            finessed_arr = apply_finesse(mask_arr, finesse_dict, i, session_id)
            Image.fromarray(finessed_arr).save(os.path.join(masks_dir, f"{i:05d}.png"))

            if progress_callback:
                progress_callback(i, total)
        return

    # SAM 2 Propagation
    inference_state = predictor.init_state(video_path=frames_dir)

    # 1. Feed clicks and boxes on keyframes to SAM 2
    for frame_str, prompt in prompts_dict.items():
        f_idx = int(frame_str)
        pts = prompt.get("points", [])
        lbls = prompt.get("labels", [])
        bx = prompt.get("box", None)

        if pts or bx:
            predictor.add_new_points_or_box(
                inference_state=inference_state,
                frame_idx=f_idx,
                obj_id=1,
                points=np.array(pts) if pts else None,
                labels=np.array(lbls) if lbls else None,
                box=np.array(bx) if bx else None
            )

    # 2. Propagate
    reverse_prop = (direction == "backward")
    device_type = "cuda" if DEVICE == "cuda" else ("xpu" if DEVICE == "xpu" else "cpu")
    dtype = torch.float16 if DEVICE in ("cuda", "xpu") else torch.bfloat16

    from concurrent.futures import ThreadPoolExecutor

    def save_mask_files(raw_path, mask_arr, finessed_path, finessed_arr):
        Image.fromarray(mask_arr).save(raw_path, "PNG", compress_level=1)
        Image.fromarray(finessed_arr).save(finessed_path, "PNG", compress_level=1)

    with ThreadPoolExecutor(max_workers=2) as executor:
        with torch.inference_mode(), torch.autocast(device_type=device_type, dtype=dtype):
            for frame_idx, obj_ids, masks in predictor.propagate_in_video(
                inference_state,
                start_frame_idx=start_frame,
                reverse=reverse_prop
            ):
                mask = (masks[0][0] > 0).cpu().numpy().astype(np.uint8) * 255

                # Apply paint strokes if any
                strokes_data = prompts_dict.get(str(frame_idx), {}).get("strokes", [])
                if strokes_data:
                    strokes = [Stroke(**s) for s in strokes_data]
                    mask = draw_strokes_on_mask(mask, strokes)

                # Save raw mask
                raw_path = os.path.join(masks_dir, f"raw_{frame_idx:05d}.png")
                # Apply finesse and save finessed mask
                finessed_path = os.path.join(masks_dir, f"{frame_idx:05d}.png")
                finessed = apply_finesse(mask, finesse_dict, frame_idx, session_id)

                # Submit to background threads so GPU doesn't block waiting for disk I/O
                executor.submit(save_mask_files, raw_path, mask, finessed_path, finessed)

                if progress_callback:
                    progress_callback(frame_idx, total)

    predictor.reset_state(inference_state)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_demo_mask(shape, points) -> np.ndarray:
    """
    Return a fake elliptical mask for demo / no-SAM2 mode.
    Centred on the mean of the clicked points.
    """
    h, w = shape
    mask = np.zeros((h, w), dtype=np.uint8)
    if points:
        cx = int(np.mean([p[0] for p in points]))
        cy = int(np.mean([p[1] for p in points]))
    else:
        cx, cy = w // 2, h // 2
    rw, rh = w // 4, h // 4
    Y, X = np.ogrid[:h, :w]
    ellipse = ((X - cx) ** 2 / rw ** 2 + (Y - cy) ** 2 / rh ** 2) <= 1
    mask[ellipse] = 255
    return mask
