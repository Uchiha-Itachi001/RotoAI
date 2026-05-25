"""
RotoAI — FastAPI application entry point.

Starts:
  - Session cleanup background task
  - CORS middleware
  - All API routers (upload, mask, process, export)
  - WebSocket endpoint for progress streaming
  - Gradio debug UI at /gradio
  - Static file serving for extracted frames/masks
"""

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import os
import logging

# Gradio is optional — app runs fine without it (debug UI just won't be available)
try:
    import gradio as gr
    from gradio_app import create_gradio_app
    _GRADIO_AVAILABLE = True
except ImportError:
    gr = None
    _GRADIO_AVAILABLE = False

from services.session_service import cleanup_old_sessions
from routers import upload, mask, process, export
from websocket_manager import manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("rotoai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---- Startup ----
    sessions_dir = os.getenv("SESSIONS_DIR", "./tmp/sessions")
    os.makedirs(sessions_dir, exist_ok=True)
    logger.info(f"Sessions directory: {os.path.abspath(sessions_dir)}")

    # Start background session cleanup
    cleanup_task = asyncio.create_task(cleanup_old_sessions())
    logger.info("Session cleanup task started.")

    yield

    # ---- Shutdown ----
    cleanup_task.cancel()
    logger.info("RotoAI shutting down.")


app = FastAPI(
    title="RotoAI",
    description="AI-powered video rotoscoping / masking tool",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow React dev server + same origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev
        "http://localhost:3000",   # alt dev
        "http://localhost:8000",   # production (same-origin)
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- API Routers ----
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(mask.router, prefix="/api", tags=["mask"])
app.include_router(process.router, prefix="/api", tags=["process"])
app.include_router(export.router, prefix="/api", tags=["export"])


@app.get("/api/health", tags=["health"])
async def health():
    from services.sam2_service import DEVICE
    import torch
    gpu_name = "none"
    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
    elif hasattr(torch, "xpu") and torch.xpu.is_available():
        gpu_name = "Intel GPU (XPU)"
    return {
        "status": "online",
        "device": DEVICE,
        "gpu": gpu_name
    }


# ---- WebSocket endpoint ----
@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await manager.connect(session_id, websocket)
    try:
        while True:
            # Keep connection alive; client sends pings / we just listen
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except Exception:
        manager.disconnect(session_id)


# ---- Gradio debug UI (optional) ----
if _GRADIO_AVAILABLE:
    try:
        gradio_app = create_gradio_app()
        app = gr.mount_gradio_app(app, gradio_app, path="/gradio")
        logger.info("Gradio debug UI mounted at /gradio")
    except Exception as e:
        logger.warning(f"Could not mount Gradio: {e}")
else:
    logger.info("Gradio not installed — /gradio debug UI skipped. Install with: pip install gradio")


# ---- Static file serving (frames, masks) ----
sessions_dir = os.getenv("SESSIONS_DIR", "./tmp/sessions")
os.makedirs(sessions_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=sessions_dir), name="static")

# ---- Serve built React app (production) ----
dist_dir = "./dist"
if os.path.exists(dist_dir):
    app.mount("/", StaticFiles(directory=dist_dir, html=True), name="frontend")
    logger.info("Serving built React app from ./dist")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info",
    )
