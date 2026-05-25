import cv2
import numpy as np
import os
import io
import base64
from PIL import Image, ImageFilter
from services.session_service import get_session_path

def apply_finesse(
    mask_arr: np.ndarray,
    finesse: dict,
    frame_idx: int = None,
    session_id: str = None
) -> np.ndarray:
    """
    Apply mask finesse post-processing sliders:
      - smoothing (0-100)
      - denoise (0-100)
      - consistency (0-100)
      - blurRadius (0-100)
      - edgeExpand (-50 to 50)
      - cleanBlack (0-100)
      - cleanWhite (0-100)
      - smartRefine (bool)
      - inOutRatio (-1.0 to 1.0)
    """
    out = mask_arr.copy()
    
    # 1. Temporal Consistency (anti-flicker)
    consistency = finesse.get("consistency", 0)
    if consistency > 0 and session_id and frame_idx is not None:
        session_path = get_session_path(session_id)
        masks_dir = os.path.join(session_path, "masks")
        prev_path = os.path.join(masks_dir, f"{frame_idx-1:05d}.png")
        next_path = os.path.join(masks_dir, f"{frame_idx+1:05d}.png")
        
        blend_masks = [out]
        if os.path.exists(prev_path):
            try:
                prev_mask = np.array(Image.open(prev_path).convert("L"))
                blend_masks.append(prev_mask)
            except Exception:
                pass
        if os.path.exists(next_path):
            try:
                next_mask = np.array(Image.open(next_path).convert("L"))
                blend_masks.append(next_mask)
            except Exception:
                pass
                
        if len(blend_masks) > 1:
            # weight of current frame decreases as consistency increases
            w_curr = 1.0 - (consistency / 100.0) * 0.7
            w_other = (1.0 - w_curr) / (len(blend_masks) - 1)
            acc = out.astype(np.float32) * w_curr
            for m in blend_masks[1:]:
                acc += m.astype(np.float32) * w_other
            _, out = cv2.threshold(acc.astype(np.uint8), 127, 255, cv2.THRESH_BINARY)

    # 2. Denoise (morphological open/close)
    denoise = finesse.get("denoise", 0)
    if denoise > 0:
        ksize = int(denoise / 10) * 2 + 1
        if ksize >= 3:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize, ksize))
            out = cv2.morphologyEx(out, cv2.MORPH_OPEN, kernel)
            out = cv2.morphologyEx(out, cv2.MORPH_CLOSE, kernel)

    # 3. Clean Black (remove small background specks)
    clean_black = finesse.get("cleanBlack", 0)
    if clean_black > 0:
        thresh_area = clean_black * 20
        num_labels, labels_im, stats, centroids = cv2.connectedComponentsWithStats(out)
        for label in range(1, num_labels):
            area = stats[label, cv2.CC_STAT_AREA]
            if area < thresh_area:
                out[labels_im == label] = 0

    # 4. Clean White (fill holes inside subject)
    clean_white = finesse.get("cleanWhite", 0)
    if clean_white > 0:
        thresh_area = clean_white * 20
        inverted = cv2.bitwise_not(out)
        num_labels, labels_im, stats, centroids = cv2.connectedComponentsWithStats(inverted)
        for label in range(1, num_labels):
            area = stats[label, cv2.CC_STAT_AREA]
            if area < thresh_area:
                out[labels_im == label] = 255

    # 5. Edge Expand (shrink or grow)
    edge_expand = finesse.get("edgeExpand", 0)
    if edge_expand != 0:
        ksize = abs(edge_expand)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize * 2 + 1, ksize * 2 + 1))
        if edge_expand > 0:
            out = cv2.dilate(out, kernel)
        else:
            out = cv2.erode(out, kernel)

    # 6. Smoothing (contours anti-aliasing)
    smoothing = finesse.get("smoothing", 0)
    if smoothing > 0:
        ksize = int(smoothing / 5) * 2 + 1
        if ksize >= 3:
            out = cv2.GaussianBlur(out, (ksize, ksize), 0)
            _, out = cv2.threshold(out, 127, 255, cv2.THRESH_BINARY)

    # 7. Blur Radius (feathering) + In/Out Ratio
    blur_radius = finesse.get("blurRadius", 0)
    in_out_ratio = finesse.get("inOutRatio", 0.0)
    if blur_radius > 0:
        ksize = int(blur_radius / 2) * 2 + 1
        if ksize >= 3:
            blurred = cv2.GaussianBlur(out, (ksize, ksize), 0)
            if in_out_ratio != 0:
                shift = int(in_out_ratio * 127)
                blurred = np.clip(blurred.astype(np.int16) + shift, 0, 255).astype(np.uint8)
            out = blurred

    # Invert mask if toggled
    if finesse.get("inverted", False):
        out = cv2.bitwise_not(out)

    return out

def generate_overlay(mask_arr: np.ndarray, mode: str) -> str:
    """
    Generate a base64 encoded RGBA PNG overlay for the given mask and overlay mode:
      - color: purple subject, transparent bg, gold border
      - rubylith: transparent subject, dark crimson bg, gold border
      - highlight: transparent subject, darkened 60% bg
      - outline: gold boundary outline only
      - bw: white inside subject, black outside
    """
    h, w = mask_arr.shape
    overlay_rgba = np.zeros((h, w, 4), dtype=np.uint8)
    
    # Threshold mask to handle feathered edges for contour extraction
    binary_mask = (mask_arr > 128).astype(np.uint8) * 255
    fg_mask = binary_mask > 0
    bg_mask = ~fg_mask
    
    # Boundary outline -> bright golden for edge visibility
    mask_pil = Image.fromarray(binary_mask)
    dilated = np.array(mask_pil.filter(ImageFilter.MaxFilter(5)))
    eroded  = np.array(mask_pil.filter(ImageFilter.MinFilter(5)))
    boundary = (dilated.astype(np.int16) - eroded.astype(np.int16)) > 50

    if mode == "color":
        overlay_rgba[fg_mask] = [108, 99, 255, 115]  # purple, ~45% opacity
        overlay_rgba[boundary] = [255, 215, 0, 255]  # bright gold
    elif mode == "rubylith":
        overlay_rgba[bg_mask] = [160, 20, 20, 185]   # dark crimson, ~73% opacity
        overlay_rgba[boundary] = [255, 215, 0, 255]  # bright gold
    elif mode == "highlight":
        overlay_rgba[bg_mask] = [0, 0, 0, 153]        # 60% opacity black
    elif mode == "outline":
        overlay_rgba[boundary] = [255, 215, 0, 255]  # bright gold
    elif mode == "bw":
        overlay_rgba[fg_mask] = [255, 255, 255, 255] # opaque white
        overlay_rgba[bg_mask] = [0, 0, 0, 255]        # opaque black
    else:
        # Default fallback to rubylith
        overlay_rgba[bg_mask] = [160, 20, 20, 185]
        overlay_rgba[boundary] = [255, 215, 0, 255]

    overlay_img = Image.fromarray(overlay_rgba, "RGBA")
    buf = io.BytesIO()
    overlay_img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()
