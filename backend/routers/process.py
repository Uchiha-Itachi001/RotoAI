"""
POST /api/process    — Start full-video mask propagation (async background task).
DELETE /api/session/{session_id} — Cancel processing and delete session.
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Optional
from services.sam2_service import predict_video
from services.session_service import get_session_path, delete_session, load_session_meta
from websocket_manager import manager
import asyncio
import os
import threading

router = APIRouter()

# Track active processing jobs so we can report if one is already running
_active_jobs: dict = {}  # session_id -> threading.Thread


class ProcessRequest(BaseModel):
    session_id: str
    direction: str = "forward"     # "forward" | "backward"
    start_frame: int = 0


@router.post("/process")
async def process_video(req: ProcessRequest, background_tasks: BackgroundTasks):
    """
    Kick off video mask propagation as a background task.
    Progress is streamed via WebSocket /ws/{session_id}.
    """
    session_path = get_session_path(req.session_id)
    if not os.path.exists(session_path):
        raise HTTPException(status_code=404, detail="Session not found.")

    if req.session_id in _active_jobs and _active_jobs[req.session_id].is_alive():
        raise HTTPException(status_code=409, detail="Processing already in progress for this session.")

    # We must capture the current event loop now
    loop = asyncio.get_event_loop()

    background_tasks.add_task(
        _run_processing_background,
        req.session_id,
        req.start_frame,
        req.direction,
        loop,
    )

    return {"status": "started", "session_id": req.session_id}


@router.delete("/session/{session_id}")
async def cancel_and_delete(session_id: str):
    """Cancel any ongoing processing and delete the session."""
    delete_session(session_id)
    _active_jobs.pop(session_id, None)
    return {"status": "deleted", "session_id": session_id}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _run_processing_background(
    session_id: str,
    start_frame: int,
    direction: str,
    loop: asyncio.AbstractEventLoop,
):
    """
    Runs in a FastAPI BackgroundTask.
    """
    session_path = get_session_path(session_id)
    frames_dir = os.path.join(session_path, "frames")
    masks_dir = os.path.join(session_path, "masks")
    
    meta = load_session_meta(session_id)
    total_frames = meta.get("total_frames", 0)
    prompts_dict = meta.get("prompts", {})
    finesse_dict = meta.get("finesse", {})

    def send(data: dict):
        asyncio.run_coroutine_threadsafe(
            manager.send_progress(session_id, data), loop
        )

    def progress_cb(frame_idx: int, total: int):
        send({
            "frame": frame_idx,
            "total": total,
            "status": "processing",
        })

    try:
        predict_video(
            frames_dir=frames_dir,
            masks_dir=masks_dir,
            prompts_dict=prompts_dict,
            finesse_dict=finesse_dict,
            session_id=session_id,
            start_frame=start_frame,
            direction=direction,
            progress_callback=progress_cb,
        )
        send({"status": "done", "session_id": session_id})
    except Exception as e:
        send({"status": "error", "message": str(e)})
    finally:
        _active_jobs.pop(session_id, None)
