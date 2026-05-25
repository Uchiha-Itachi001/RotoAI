"""
POST /api/upload — Video upload and session initialization.

PRD §4.1 / §6
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from services.session_service import create_session, get_session_path, save_session_meta
from services.ffmpeg_service import extract_frames, get_video_info
import aiofiles
import os
import base64
import json
from typing import Optional

router = APIRouter()

# Accepted MIME types (browsers vary for .mov / .webm)
ALLOWED_TYPES = {
    "video/mp4",
    "video/quicktime",    # .mov
    "video/webm",
    "video/x-matroska",  # .mkv fallback
    "application/octet-stream",  # some browsers send this for .mov
}

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", 500))


def save_progress(session_id: str, data: dict):
    """Write progress data to progress.json in the session folder."""
    session_path = get_session_path(session_id)
    progress_path = os.path.join(session_path, "progress.json")
    with open(progress_path, "w") as f:
        json.dump(data, f)


@router.post("/upload")
async def upload_video(
    file: UploadFile = File(...),
    start_time: float = Form(0.0),
    end_time: float = Form(-1.0),
    fps: float = Form(-1.0),
    session_id: Optional[str] = Form(None)
):
    """
    Accept a video file and custom frame range / FPS settings,
    extract the selected frames, return session metadata and the first frame.
    """
    # Content-type guard (permissive — file extension is the real check)
    if file.content_type not in ALLOWED_TYPES:
        # Allow any file whose name ends in a video extension even if MIME is wrong
        ext = (file.filename or "").lower().rsplit(".", 1)[-1]
        if ext not in {"mp4", "mov", "webm", "mkv"}:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {file.content_type}. "
                       "Please upload an MP4, MOV, or WebM file."
            )

    # Read file content (memory-efficient for large files)
    content = await file.read()

    # Size guard
    size_mb = len(content) / (1024 * 1024)
    if size_mb > MAX_UPLOAD_MB:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({size_mb:.1f} MB). Maximum is {MAX_UPLOAD_MB} MB."
        )

    # Create session directory structure
    if not session_id:
        session_id = create_session()
    
    session_path = get_session_path(session_id)
    os.makedirs(os.path.join(session_path, "frames"), exist_ok=True)
    os.makedirs(os.path.join(session_path, "masks"), exist_ok=True)
    video_path = os.path.join(session_path, "input.mp4")

    # Persist uploaded video
    async with aiofiles.open(video_path, "wb") as f:
        await f.write(content)

    # Extract frames and collect metadata
    frames_dir = os.path.join(session_path, "frames")
    try:
        info = get_video_info(video_path)
        original_fps = info["fps"]
        total_video_frames = info["total_frames"]

        # Calculate start/end frames from start_time / end_time in seconds
        start_frame = int(start_time * original_fps)
        if end_time > 0:
            end_frame = int(end_time * original_fps)
            end_frame = min(end_frame, total_video_frames - 1)
        else:
            end_frame = -1

        start_frame = min(max(0, start_frame), total_video_frames - 1)

        # Estimate expected frame count to display in progress
        if end_frame > 0:
            expected_total = end_frame - start_frame + 1
        else:
            expected_total = total_video_frames - start_frame

        if fps > 0 and abs(fps - original_fps) > 0.01:
            duration = expected_total / original_fps
            expected_total = int(duration * fps)

        save_progress(session_id, {"status": "extracting", "frame": 0, "total": max(1, expected_total)})

        def progress_cb(count):
            save_progress(session_id, {"status": "extracting", "frame": count, "total": max(1, expected_total)})

        total_frames = extract_frames(video_path, frames_dir, start_frame, end_frame, fps, progress_cb)
        save_progress(session_id, {"status": "done", "frame": total_frames, "total": total_frames})
    except Exception as e:
        save_progress(session_id, {"status": "error", "message": str(e)})
        raise HTTPException(
            status_code=422,
            detail=f"Could not process video: {str(e)}. "
                   "Make sure ffmpeg is installed and on PATH."
        )

    # Save metadata for later use (export, etc.)
    meta = {
        "fps": fps if fps > 0 else info["fps"],
        "total_frames": total_frames,
        "width": info["width"],
        "height": info["height"],
        "original_filename": file.filename,
    }
    save_session_meta(session_id, meta)

    # Read first frame as base64 for the canvas
    first_frame_path = os.path.join(frames_dir, "00001.jpg")
    if not os.path.exists(first_frame_path):
        raise HTTPException(status_code=500, detail="Frame extraction produced no output.")

    with open(first_frame_path, "rb") as f:
        first_frame_b64 = base64.b64encode(f.read()).decode()

    return {
        "session_id": session_id,
        "first_frame_b64": first_frame_b64,
        "total_frames": total_frames,
        "fps": meta["fps"],
        "width": info["width"],
        "height": info["height"],
    }


@router.get("/session/{session_id}")
async def get_session(session_id: str):
    """
    Retrieve session metadata (e.g. frame count, fps, dimensions).
    """
    from services.session_service import load_session_meta, get_session_path
    
    session_path = get_session_path(session_id)
    if not os.path.exists(session_path):
        raise HTTPException(status_code=404, detail="Session not found.")
        
    meta = load_session_meta(session_id)
    return meta


@router.get("/session/{session_id}/progress")
async def get_session_progress(session_id: str):
    """
    Retrieve current frame extraction progress.
    """
    session_path = get_session_path(session_id)
    progress_path = os.path.join(session_path, "progress.json")
    if os.path.exists(progress_path):
        with open(progress_path, "r") as f:
            return json.load(f)
    return {"status": "initializing", "frame": 0, "total": 100}

