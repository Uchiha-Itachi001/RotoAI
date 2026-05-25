"""
POST /api/export           — Render final output video in chosen format.
GET  /api/download/{session_id}/{mode} — Download the exported file.

PRD §4.4 / §5
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
from services.session_service import get_session_path, load_session_meta
from services.ffmpeg_service import (
    export_bw_matte,
    export_alpha_channel,
    export_greenscreen,
)
import os

router = APIRouter()

# Track export status per session
_export_status: dict = {}  # session_id -> { "mode": ..., "status": "done"|"processing"|"error", "path": ... }


class ExportRequest(BaseModel):
    session_id: str
    mode: str       # "bw_matte" | "alpha" | "greenscreen"
    quality: str    # "draft" | "full"


@router.post("/export")
async def export_video(req: ExportRequest, background_tasks: BackgroundTasks):
    """Start video export in the requested mode."""
    session_path = get_session_path(req.session_id)
    if not os.path.exists(session_path):
        raise HTTPException(status_code=404, detail="Session not found.")

    masks_dir = os.path.join(session_path, "masks")
    if not os.listdir(masks_dir):
        raise HTTPException(
            status_code=409,
            detail="No masks found. Run processing first."
        )

    meta = load_session_meta(req.session_id)
    fps = meta.get("fps", 24.0)

    mode_to_ext = {
        "bw_matte": ".mp4",
        "alpha": ".webm",
        "greenscreen": ".mp4",
    }
    ext = mode_to_ext.get(req.mode, ".mp4")
    output_path = os.path.join(session_path, f"output_{req.mode}{ext}")

    _export_status[req.session_id] = {"status": "processing", "mode": req.mode}

    background_tasks.add_task(
        _do_export,
        req.session_id,
        req.mode,
        fps,
        output_path,
    )

    return {
        "status": "processing",
        "download_url": f"/api/download/{req.session_id}/{req.mode}",
    }


@router.get("/export/status/{session_id}")
async def export_status(session_id: str):
    """Poll export status before downloading."""
    status = _export_status.get(session_id)
    if status is None:
        raise HTTPException(status_code=404, detail="No export found for this session.")
    return status


@router.get("/download/{session_id}/{mode}")
async def download_file(session_id: str, mode: str):
    """Return the exported file for download."""
    session_path = get_session_path(session_id)

    # Try both extensions
    for ext in [".mp4", ".webm", ".mov"]:
        file_path = os.path.join(session_path, f"output_{mode}{ext}")
        if os.path.exists(file_path):
            media_type = "video/webm" if ext == ".webm" else "video/mp4"
            return FileResponse(
                file_path,
                media_type=media_type,
                filename=f"rotoai_{mode}{ext}"
            )

    raise HTTPException(
        status_code=404,
        detail="Export file not found. The export may still be processing."
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _do_export(session_id: str, mode: str, fps: float, output_path: str):
    session_path = get_session_path(session_id)
    frames_dir = os.path.join(session_path, "frames")
    masks_dir = os.path.join(session_path, "masks")

    try:
        if mode == "bw_matte":
            export_bw_matte(masks_dir, output_path, fps)
        elif mode == "alpha":
            actual_path = export_alpha_channel(frames_dir, masks_dir, output_path, fps)
            output_path = actual_path
        elif mode == "greenscreen":
            export_greenscreen(frames_dir, masks_dir, output_path, fps)
        else:
            raise ValueError(f"Unknown export mode: {mode}")

        _export_status[session_id] = {
            "status": "done",
            "mode": mode,
            "path": output_path,
            "download_url": f"/api/download/{session_id}/{mode}",
        }
    except Exception as e:
        _export_status[session_id] = {
            "status": "error",
            "mode": mode,
            "message": str(e),
        }
