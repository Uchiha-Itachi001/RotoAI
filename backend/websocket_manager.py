"""
WebSocket manager for real-time progress streaming.

Keeps one WebSocket connection per session_id and provides a
thread-safe send_progress helper used by background processing tasks.
"""

from fastapi import WebSocket
from typing import Dict
import asyncio
import json
import logging

logger = logging.getLogger(__name__)


class WebSocketManager:
    def __init__(self):
        self.connections: Dict[str, WebSocket] = {}

    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.connections[session_id] = websocket
        logger.info(f"WebSocket connected: {session_id}")

    def disconnect(self, session_id: str):
        self.connections.pop(session_id, None)
        logger.info(f"WebSocket disconnected: {session_id}")

    async def send_progress(self, session_id: str, data: dict):
        """Send a JSON progress event to the client for this session."""
        ws = self.connections.get(session_id)
        if ws:
            try:
                await ws.send_text(json.dumps(data))
            except Exception as e:
                logger.warning(f"WS send failed for {session_id}: {e}")
                self.disconnect(session_id)

    def send_progress_sync(self, session_id: str, data: dict, loop: asyncio.AbstractEventLoop):
        """
        Thread-safe version for use from synchronous background tasks.
        Schedules the coroutine on the given event loop.
        """
        if session_id not in self.connections:
            return
        future = asyncio.run_coroutine_threadsafe(
            self.send_progress(session_id, data), loop
        )
        try:
            future.result(timeout=2)
        except Exception as e:
            logger.debug(f"WS sync send timeout/error: {e}")


# Global singleton used by all routers
manager = WebSocketManager()
