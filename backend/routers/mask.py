"""
POST /api/preview_mask — Single-frame SAM 2 mask preview.
POST /api/finesse      — Apply mask finesse sliders to raw mask.
GET  /api/frame        — Get a frame image and mask/overlay if it exists.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import os
import base64
import io
import cv2
import numpy as np
from PIL import Image

from services.sam2_service import predict_single_frame, _make_demo_mask, get_image_predictor
from services.session_service import get_session_path, load_session_meta, save_session_meta
from services.finesse_service import apply_finesse, generate_overlay

router = APIRouter()

class Stroke(BaseModel):
    points: List[List[float]]  # [[x, y], ...]
    radius: float
    label: int                 # 1=fg (paint add), 0=bg (paint subtract)

class PreviewMaskRequest(BaseModel):
    session_id: str
    frame_idx: int = 0
    points: List[List[float]] = []
    labels: List[int] = []
    strokes: List[Stroke] = []
    box: Optional[List[float]] = None
    finesse: Optional[dict] = None
    overlay_mode: str = "rubylith"

class FinesseRequest(BaseModel):
    session_id: str
    frame_idx: int
    finesse: dict
    overlay_mode: str = "rubylith"


def draw_strokes_on_mask(mask_arr: np.ndarray, strokes: List[Stroke]) -> np.ndarray:
    """Draw paint brush strokes directly onto a mask array."""
    out = mask_arr.copy()
    for stroke in strokes:
        points = stroke.points
        if not points:
            continue
        radius = stroke.radius
        val = 255 if stroke.label == 1 else 0
        
        # If there's only one point, draw a circle
        if len(points) == 1:
            cx, cy = int(points[0][0]), int(points[0][1])
            cv2.circle(out, (cx, cy), int(radius), val, -1)
        else:
            # Draw line segments
            for i in range(len(points) - 1):
                p1 = (int(points[i][0]), int(points[i][1]))
                p2 = (int(points[i+1][0]), int(points[i+1][1]))
                cv2.line(out, p1, p2, val, thickness=int(radius * 2), lineType=cv2.LINE_AA)
    return out


@router.post("/preview_mask")
async def preview_mask(req: PreviewMaskRequest):
    session_path = get_session_path(req.session_id)
    frame_name = f"{req.frame_idx + 1:05d}.jpg"
    frame_path = os.path.join(session_path, "frames", frame_name)

    if not os.path.exists(frame_path):
        raise HTTPException(
            status_code=404,
            detail=f"Frame {req.frame_idx} not found for session {req.session_id}."
        )

    # 1. Run single-frame SAM 2 or demo ellipse
    try:
        # Load frame to verify dimensions
        img = Image.open(frame_path)
        w, h = img.size
        
        if req.points or req.box:
            # Predict base mask using SAM 2
            mask_arr = predict_single_frame(
                frame_path,
                points=req.points,
                labels=req.labels,
                box=req.box
            )
        else:
            # Start with blank mask if no points/boxes are provided (but strokes might be)
            mask_arr = np.zeros((h, w), dtype=np.uint8)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        # Graceful fallback to demo mask if SAM 2 fails
        img = Image.open(frame_path)
        mask_arr = _make_demo_mask(img.size[::-1], req.points)

    # 2. Draw paint brush strokes on top of mask
    if req.strokes:
        mask_arr = draw_strokes_on_mask(mask_arr, req.strokes)

    # Save the raw mask (pre-finesse) to raw_{frame_idx:05d}.png
    masks_dir = os.path.join(session_path, "masks")
    os.makedirs(masks_dir, exist_ok=True)
    raw_path = os.path.join(masks_dir, f"raw_{req.frame_idx:05d}.png")
    Image.fromarray(mask_arr).save(raw_path)

    # Save the points / box / strokes to session metadata for frame index
    meta = load_session_meta(req.session_id)
    if "prompts" not in meta:
        meta["prompts"] = {}
    
    # Store prompt list for this frame index so it can be re-run or edited
    meta["prompts"][str(req.frame_idx)] = {
        "points": req.points,
        "labels": req.labels,
        "box": req.box,
        "strokes": [s.model_dump() for s in req.strokes]
    }
    
    # Save the current overlay_mode and finesse parameters
    if req.finesse:
        meta["finesse"] = req.finesse
    meta["overlay_mode"] = req.overlay_mode
    save_session_meta(req.session_id, meta)

    # 3. Apply finesse sliders
    finesse_params = req.finesse or {}
    finessed_arr = apply_finesse(mask_arr, finesse_params, req.frame_idx, req.session_id)

    # Save the finessed mask to {frame_idx:05d}.png
    finessed_path = os.path.join(masks_dir, f"{req.frame_idx:05d}.png")
    Image.fromarray(finessed_arr).save(finessed_path)

    # 4. Convert mask to base64
    buf = io.BytesIO()
    Image.fromarray(finessed_arr).save(buf, format="PNG")
    mask_b64 = base64.b64encode(buf.getvalue()).decode()

    # 5. Generate overlay
    overlay_b64 = generate_overlay(finessed_arr, req.overlay_mode)

    return {
        "mask_b64": mask_b64,
        "overlay_b64": overlay_b64,
    }


@router.post("/finesse")
async def finesse_mask(req: FinesseRequest):
    session_path = get_session_path(req.session_id)
    masks_dir = os.path.join(session_path, "masks")
    
    raw_path = os.path.join(masks_dir, f"raw_{req.frame_idx:05d}.png")
    finessed_path = os.path.join(masks_dir, f"{req.frame_idx:05d}.png")

    # Load raw mask if it exists, otherwise fall back to finessed, or error
    if os.path.exists(raw_path):
        raw_img = Image.open(raw_path).convert("L")
        mask_arr = np.array(raw_img)
    elif os.path.exists(finessed_path):
        # Treat finessed path as raw if raw_path is missing
        finessed_img = Image.open(finessed_path).convert("L")
        mask_arr = np.array(finessed_img)
    else:
        # Create a blank mask of frame size if nothing exists yet
        meta = load_session_meta(req.session_id)
        w = meta.get("width", 1920)
        h = meta.get("height", 1080)
        mask_arr = np.zeros((h, w), dtype=np.uint8)

    # Save updated finesse parameters in session
    meta = load_session_meta(req.session_id)
    meta["finesse"] = req.finesse
    meta["overlay_mode"] = req.overlay_mode
    save_session_meta(req.session_id, meta)

    # Apply finesse sliders
    finessed_arr = apply_finesse(mask_arr, req.finesse, req.frame_idx, req.session_id)

    # Save new finessed mask
    Image.fromarray(finessed_arr).save(finessed_path)

    # Convert to base64
    buf = io.BytesIO()
    Image.fromarray(finessed_arr).save(buf, format="PNG")
    mask_b64 = base64.b64encode(buf.getvalue()).decode()

    # Generate overlay
    overlay_b64 = generate_overlay(finessed_arr, req.overlay_mode)

    return {
        "mask_b64": mask_b64,
        "overlay_b64": overlay_b64,
    }


@router.get("/frame/{session_id}/{frame_idx}")
async def get_frame(session_id: str, frame_idx: int):
    session_path = get_session_path(session_id)
    frame_name = f"{frame_idx + 1:05d}.jpg"
    frame_path = os.path.join(session_path, "frames", frame_name)

    if not os.path.exists(frame_path):
        raise HTTPException(
            status_code=404,
            detail=f"Frame {frame_idx} not found for session {session_id}."
        )

    # Load frame image as base64
    with open(frame_path, "rb") as f:
        frame_b64 = base64.b64encode(f.read()).decode()

    # Check if a finessed mask exists
    masks_dir = os.path.join(session_path, "masks")
    mask_path = os.path.join(masks_dir, f"{frame_idx:05d}.png")
    
    mask_b64 = None
    overlay_b64 = None

    if os.path.exists(mask_path):
        try:
            mask_img = Image.open(mask_path).convert("L")
            mask_arr = np.array(mask_img)
            
            # Convert mask to base64
            buf = io.BytesIO()
            mask_img.save(buf, format="PNG")
            mask_b64 = base64.b64encode(buf.getvalue()).decode()

            # Retrieve overlay mode
            meta = load_session_meta(session_id)
            overlay_mode = meta.get("overlay_mode", "rubylith")
            
            # Generate overlay
            overlay_b64 = generate_overlay(mask_arr, overlay_mode)
        except Exception:
            pass

    return {
        "frame_b64": frame_b64,
        "mask_b64": mask_b64,
        "overlay_b64": overlay_b64,
    }


@router.get("/model_status")
async def get_model_status():
    from services.sam2_service import _check_sam2, CHECKPOINT, DEVICE
    import os
    
    sam2_installed = _check_sam2()
    checkpoint_exists = os.path.exists(CHECKPOINT)
    
    is_demo = not (sam2_installed and checkpoint_exists)
    
    if is_demo:
        active_model = "Demo Mode (Ellipse Simulation)"
    else:
        active_model = f"SAM 2.1 Hiera Base+ ({DEVICE.upper()})"
        
    return {
        "sam2_installed": sam2_installed,
        "checkpoint_exists": checkpoint_exists,
        "device": DEVICE,
        "active_model": active_model,
        "is_demo": is_demo
    }
