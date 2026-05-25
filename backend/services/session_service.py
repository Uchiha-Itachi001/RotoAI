import uuid
import os
import shutil
import asyncio
import json
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()
SESSIONS_DIR = os.getenv("SESSIONS_DIR", "./tmp/sessions")


def create_session() -> str:
    """Create a new session directory and return its UUID."""
    session_id = str(uuid.uuid4())
    session_path = os.path.join(SESSIONS_DIR, session_id)
    os.makedirs(os.path.join(session_path, "frames"), exist_ok=True)
    os.makedirs(os.path.join(session_path, "masks"), exist_ok=True)
    return session_id


def get_session_path(session_id: str) -> str:
    """Return the filesystem path for a session."""
    return os.path.join(SESSIONS_DIR, session_id)


def save_session_meta(session_id: str, metadata: dict):
    """Persist session metadata to meta.json."""
    session_path = get_session_path(session_id)
    meta_path = os.path.join(session_path, "meta.json")
    with open(meta_path, "w") as f:
        json.dump(metadata, f)


def load_session_meta(session_id: str) -> dict:
    """Load session metadata from meta.json."""
    meta_path = os.path.join(get_session_path(session_id), "meta.json")
    if os.path.exists(meta_path):
        with open(meta_path, "r") as f:
            return json.load(f)
    return {}


def delete_session(session_id: str):
    """Delete a session directory and all its contents."""
    path = get_session_path(session_id)
    if os.path.exists(path):
        shutil.rmtree(path)


async def cleanup_old_sessions():
    """Background task — deletes sessions older than MAX_SESSION_AGE_HOURS."""
    max_age = int(os.getenv("MAX_SESSION_AGE_HOURS", 2))
    while True:
        await asyncio.sleep(3600)  # check every hour
        if not os.path.exists(SESSIONS_DIR):
            continue
        for session_id in os.listdir(SESSIONS_DIR):
            path = os.path.join(SESSIONS_DIR, session_id)
            if not os.path.isdir(path):
                continue
            try:
                created = datetime.fromtimestamp(os.path.getctime(path))
                if datetime.now() - created > timedelta(hours=max_age):
                    shutil.rmtree(path, ignore_errors=True)
            except Exception:
                pass
