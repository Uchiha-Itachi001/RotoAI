# RotoAI — Implementation Plan

> **Read PRD.md first.** This plan is sequenced so an AI coding agent can execute it top-to-bottom without backtracking.  
> Every step references the PRD section it implements.  
> Complete each phase fully before moving to the next.

---

## PHASE 0 — Environment Setup

### 0.1 System Requirements Check

Before writing any code, verify:

```bash
python --version        # Must be 3.10 or 3.11
node --version          # Must be 18+
npm --version           # Must be 9+
nvidia-smi              # Check VRAM (6GB+ recommended)
ffmpeg -version         # Must be installed
```

If ffmpeg is missing on Windows:
```bash
winget install ffmpeg
# OR download from https://ffmpeg.org/download.html and add to PATH
```

---

### 0.2 Create Project Root

```bash
mkdir rotoai
cd rotoai
mkdir backend frontend
```

---

### 0.3 Python Virtual Environment

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

---

### 0.4 Install Python Dependencies

Create `backend/requirements.txt`:

```txt
fastapi==0.111.0
uvicorn[standard]==0.29.0
python-multipart==0.0.9
websockets==12.0
gradio==4.36.0
torch==2.3.1
torchvision==0.18.1
opencv-python==4.10.0.84
ffmpeg-python==0.2.0
Pillow==10.3.0
numpy==1.26.4
aiofiles==23.2.1
python-dotenv==1.0.1
```

Install:
```bash
pip install -r requirements.txt
```

Install SAM 2 (from source):
```bash
pip install git+https://github.com/facebookresearch/sam2.git
```

Download SAM 2 model checkpoints:
```bash
mkdir -p checkpoints
# SAM 2.1 Base+ (recommended default — 308MB)
wget -P checkpoints https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt

# SAM 2.1 Large (optional — 856MB, more accurate)
wget -P checkpoints https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt
```

> **Windows note:** Replace `wget` with `curl -O` or download manually from the URLs above.

---

### 0.5 Install Frontend Dependencies

```bash
cd ../frontend
npm create vite@latest . -- --template react
npm install
npm install tailwindcss @tailwindcss/vite
npm install react-router-dom axios
npm install fabric        # canvas interactions
```

Init Tailwind:
```bash
npx tailwindcss init
```

Configure `vite.config.js` — add proxy so React dev server forwards API calls to FastAPI:

```js
// frontend/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/gradio': 'http://localhost:8000',
      '/static': 'http://localhost:8000',
    }
  }
})
```

---

### 0.6 Environment Variables

Create `backend/.env`:
```env
SAM2_CHECKPOINT=./checkpoints/sam2.1_hiera_base_plus.pt
SAM2_MODEL_CFG=configs/sam2.1/sam2.1_hiera_b+.yaml
SESSIONS_DIR=./tmp/sessions
MAX_SESSION_AGE_HOURS=2
MAX_UPLOAD_SIZE_MB=500
PORT=8000
```

---

## PHASE 1 — Backend Foundation

> **PRD Reference:** Section 5 (API Endpoints), Section 7 (Session Management)

---

### 1.1 Session Service

Create `backend/services/session_service.py`:

```python
import uuid, os, shutil, asyncio
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()
SESSIONS_DIR = os.getenv("SESSIONS_DIR", "./tmp/sessions")

def create_session() -> str:
    session_id = str(uuid.uuid4())
    session_path = os.path.join(SESSIONS_DIR, session_id)
    os.makedirs(os.path.join(session_path, "frames"), exist_ok=True)
    os.makedirs(os.path.join(session_path, "masks"), exist_ok=True)
    return session_id

def get_session_path(session_id: str) -> str:
    return os.path.join(SESSIONS_DIR, session_id)

def delete_session(session_id: str):
    path = get_session_path(session_id)
    if os.path.exists(path):
        shutil.rmtree(path)

async def cleanup_old_sessions():
    """Run as background task — deletes sessions older than MAX_SESSION_AGE_HOURS"""
    max_age = int(os.getenv("MAX_SESSION_AGE_HOURS", 2))
    while True:
        await asyncio.sleep(3600)  # check every hour
        if not os.path.exists(SESSIONS_DIR):
            continue
        for session_id in os.listdir(SESSIONS_DIR):
            path = os.path.join(SESSIONS_DIR, session_id)
            created = datetime.fromtimestamp(os.path.getctime(path))
            if datetime.now() - created > timedelta(hours=max_age):
                shutil.rmtree(path, ignore_errors=True)
```

---

### 1.2 FFmpeg Service

Create `backend/services/ffmpeg_service.py`:

```python
import subprocess, os

def extract_frames(video_path: str, output_dir: str) -> int:
    """Extract all frames from video. Returns frame count."""
    os.makedirs(output_dir, exist_ok=True)
    cmd = [
        "ffmpeg", "-i", video_path,
        "-q:v", "2",
        os.path.join(output_dir, "%05d.jpg"),
        "-y"
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return len([f for f in os.listdir(output_dir) if f.endswith(".jpg")])

def get_video_info(video_path: str) -> dict:
    """Returns fps and total frame count."""
    import json
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_streams", video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    data = json.loads(result.stdout)
    stream = next(s for s in data["streams"] if s["codec_type"] == "video")
    fps_parts = stream["r_frame_rate"].split("/")
    fps = int(fps_parts[0]) / int(fps_parts[1])
    return {"fps": fps, "total_frames": int(stream.get("nb_frames", 0))}

def composite_output(frames_dir: str, masks_dir: str, output_path: str, 
                     mode: str, fps: float):
    """
    mode: "bw_matte" | "alpha" | "greenscreen"
    Composites original frames + masks into final video.
    """
    # Implementation varies by mode — see Phase 4
    pass
```

---

### 1.3 SAM 2 Service

Create `backend/services/sam2_service.py`:

```python
import os, torch, numpy as np
from PIL import Image
from sam2.build_sam import build_sam2_video_predictor, build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from dotenv import load_dotenv

load_dotenv()

CHECKPOINT = os.getenv("SAM2_CHECKPOINT")
MODEL_CFG = os.getenv("SAM2_MODEL_CFG")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Singleton predictors (load once)
_image_predictor = None
_video_predictor = None

def get_image_predictor():
    global _image_predictor
    if _image_predictor is None:
        model = build_sam2(MODEL_CFG, CHECKPOINT, device=DEVICE)
        _image_predictor = SAM2ImagePredictor(model)
    return _image_predictor

def get_video_predictor():
    global _video_predictor
    if _video_predictor is None:
        _video_predictor = build_sam2_video_predictor(MODEL_CFG, CHECKPOINT, device=DEVICE)
    return _video_predictor

def predict_single_frame(frame_path: str, points: list, labels: list) -> np.ndarray:
    """
    points: [[x, y], [x, y], ...]
    labels: [1, 0, ...]  (1=foreground, 0=background)
    Returns: binary mask as numpy array (H, W)
    """
    predictor = get_image_predictor()
    image = Image.open(frame_path).convert("RGB")
    predictor.set_image(np.array(image))
    
    masks, scores, _ = predictor.predict(
        point_coords=np.array(points),
        point_labels=np.array(labels),
        multimask_output=False
    )
    return masks[0].astype(np.uint8) * 255

def predict_video(frames_dir: str, masks_dir: str, 
                  points: list, labels: list,
                  progress_callback=None):
    """
    Propagates mask across all frames.
    Saves mask PNGs to masks_dir.
    Calls progress_callback(frame_idx, total_frames) per frame.
    """
    predictor = get_video_predictor()
    inference_state = predictor.init_state(video_path=frames_dir)
    
    predictor.add_new_points_or_box(
        inference_state,
        frame_idx=0,
        obj_id=1,
        points=np.array(points),
        labels=np.array(labels)
    )
    
    frame_files = sorted([f for f in os.listdir(frames_dir) if f.endswith(".jpg")])
    total = len(frame_files)
    
    for frame_idx, obj_ids, masks in predictor.propagate_in_video(inference_state):
        mask = (masks[0][0] > 0).cpu().numpy().astype(np.uint8) * 255
        mask_img = Image.fromarray(mask)
        mask_img.save(os.path.join(masks_dir, f"{frame_idx:05d}.png"))
        
        if progress_callback:
            progress_callback(frame_idx, total)
    
    predictor.reset_state(inference_state)
```

---

### 1.4 WebSocket Manager

Create `backend/websocket_manager.py`:

```python
from fastapi import WebSocket
from typing import Dict
import asyncio, json

class WebSocketManager:
    def __init__(self):
        self.connections: Dict[str, WebSocket] = {}
    
    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.connections[session_id] = websocket
    
    def disconnect(self, session_id: str):
        self.connections.pop(session_id, None)
    
    async def send_progress(self, session_id: str, data: dict):
        ws = self.connections.get(session_id)
        if ws:
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                self.disconnect(session_id)

manager = WebSocketManager()
```

---

### 1.5 FastAPI Main App

Create `backend/main.py`:

```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import gradio as gr, os

from services.session_service import cleanup_old_sessions
from routers import upload, mask, process, export
from gradio_app import create_gradio_app

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    os.makedirs("./tmp/sessions", exist_ok=True)
    import asyncio
    asyncio.create_task(cleanup_old_sessions())
    yield
    # Shutdown (nothing needed)

app = FastAPI(title="RotoAI", lifespan=lifespan)

app.add_middleware(CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"], allow_headers=["*"])

# Routers
app.include_router(upload.router, prefix="/api")
app.include_router(mask.router, prefix="/api")
app.include_router(process.router, prefix="/api")
app.include_router(export.router, prefix="/api")

# WebSocket
from websocket_manager import manager
from fastapi import WebSocket

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await manager.connect(session_id, websocket)
    try:
        while True:
            await websocket.receive_text()  # keep alive
    except Exception:
        manager.disconnect(session_id)

# Mount Gradio (dev debug UI)
gradio_app = create_gradio_app()
app = gr.mount_gradio_app(app, gradio_app, path="/gradio")

# Serve static frames/masks for React canvas
app.mount("/static", StaticFiles(directory="./tmp/sessions"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
```

---

### 1.6 Gradio App (dev layer)

Create `backend/gradio_app.py`:

```python
import gradio as gr

def create_gradio_app():
    """
    Minimal Gradio interface for debugging SAM 2 directly.
    Not shown to end users — accessible at /gradio for dev.
    """
    with gr.Blocks(title="RotoAI Debug") as app:
        gr.Markdown("## RotoAI — SAM 2 Debug Interface")
        with gr.Row():
            video_input = gr.Video(label="Input Video")
            output_video = gr.Video(label="Masked Output")
        run_btn = gr.Button("Run (debug)")
        # Wire up direct SAM 2 call here for testing
    return app
```

---

### 1.7 API Routers — Stubs First

Create all 4 router files with working stubs so the app boots:

**`backend/routers/upload.py`** — PRD Section 4.1, API POST `/api/upload`:
```python
from fastapi import APIRouter, UploadFile, File, HTTPException
from services.session_service import create_session, get_session_path
from services.ffmpeg_service import extract_frames, get_video_info
import aiofiles, os, base64
from PIL import Image

router = APIRouter()

@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    # Validate
    if file.content_type not in ["video/mp4", "video/quicktime", "video/webm"]:
        raise HTTPException(400, "Unsupported file type")
    
    session_id = create_session()
    session_path = get_session_path(session_id)
    video_path = os.path.join(session_path, "input.mp4")
    
    # Save uploaded file
    async with aiofiles.open(video_path, "wb") as f:
        content = await file.read()
        await f.write(content)
    
    # Extract frames
    frames_dir = os.path.join(session_path, "frames")
    total_frames = extract_frames(video_path, frames_dir)
    info = get_video_info(video_path)
    
    # Return first frame as base64
    first_frame_path = os.path.join(frames_dir, "00001.jpg")
    with open(first_frame_path, "rb") as f:
        first_frame_b64 = base64.b64encode(f.read()).decode()
    
    return {
        "session_id": session_id,
        "first_frame_b64": first_frame_b64,
        "total_frames": total_frames,
        "fps": info["fps"]
    }
```

**`backend/routers/mask.py`** — PRD Section 4.2, API POST `/api/preview_mask`:
```python
from fastapi import APIRouter
from pydantic import BaseModel
from services.sam2_service import predict_single_frame
from services.session_service import get_session_path
import os, base64, numpy as np
from PIL import Image

router = APIRouter()

class PreviewMaskRequest(BaseModel):
    session_id: str
    points: list   # [[x, y], ...]
    labels: list   # [1, 0, ...]

@router.post("/preview_mask")
async def preview_mask(req: PreviewMaskRequest):
    session_path = get_session_path(req.session_id)
    frame_path = os.path.join(session_path, "frames", "00001.jpg")
    
    mask = predict_single_frame(frame_path, req.points, req.labels)
    
    # Convert mask to base64 PNG
    mask_img = Image.fromarray(mask)
    import io
    buf = io.BytesIO()
    mask_img.save(buf, format="PNG")
    mask_b64 = base64.b64encode(buf.getvalue()).decode()
    
    return {"mask_b64": mask_b64}
```

**`backend/routers/process.py`** — PRD Section 4.3, API POST `/api/process`:
```python
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from services.sam2_service import predict_video
from services.session_service import get_session_path
from websocket_manager import manager
import asyncio, os

router = APIRouter()

class ProcessRequest(BaseModel):
    session_id: str
    points: list
    labels: list

@router.post("/process")
async def process_video(req: ProcessRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_processing, req.session_id, req.points, req.labels)
    return {"status": "started", "session_id": req.session_id}

async def run_processing(session_id: str, points: list, labels: list):
    session_path = get_session_path(session_id)
    frames_dir = os.path.join(session_path, "frames")
    masks_dir = os.path.join(session_path, "masks")
    
    loop = asyncio.get_event_loop()
    
    def progress_cb(frame_idx, total):
        # Get preview frame path for this frame
        frame_file = os.path.join(frames_dir, f"{frame_idx+1:05d}.jpg")
        asyncio.run_coroutine_threadsafe(
            manager.send_progress(session_id, {
                "frame": frame_idx,
                "total": total,
                "status": "processing"
            }),
            loop
        )
    
    try:
        predict_video(frames_dir, masks_dir, points, labels, progress_cb)
        await manager.send_progress(session_id, {"status": "done"})
    except Exception as e:
        await manager.send_progress(session_id, {"status": "error", "message": str(e)})
```

**`backend/routers/export.py`** — PRD Section 4.4, API POST `/api/export`:
```python
from fastapi import APIRouter
from fastapi.responses import FileResponse
from pydantic import BaseModel
from services.session_service import get_session_path
import os, subprocess

router = APIRouter()

class ExportRequest(BaseModel):
    session_id: str
    mode: str   # "bw_matte" | "alpha" | "greenscreen"
    quality: str  # "draft" | "full"

@router.post("/export")
async def export_video(req: ExportRequest):
    session_path = get_session_path(req.session_id)
    frames_dir = os.path.join(session_path, "frames")
    masks_dir = os.path.join(session_path, "masks")
    output_path = os.path.join(session_path, f"output_{req.mode}.mp4")
    
    # ffmpeg composite — mode-specific logic
    if req.mode == "bw_matte":
        _export_bw_matte(frames_dir, masks_dir, output_path)
    elif req.mode == "greenscreen":
        _export_greenscreen(frames_dir, masks_dir, output_path)
    
    return {"download_url": f"/api/download/{req.session_id}/{req.mode}"}

@router.get("/download/{session_id}/{mode}")
async def download_file(session_id: str, mode: str):
    session_path = get_session_path(session_id)
    file_path = os.path.join(session_path, f"output_{mode}.mp4")
    return FileResponse(file_path, media_type="video/mp4", 
                        filename=f"rotoai_{mode}.mp4")

def _export_bw_matte(frames_dir, masks_dir, output_path):
    # ffmpeg: use mask PNGs directly as video
    cmd = [
        "ffmpeg", "-framerate", "24",
        "-i", os.path.join(masks_dir, "%05d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        output_path, "-y"
    ]
    subprocess.run(cmd, check=True)

def _export_greenscreen(frames_dir, masks_dir, output_path):
    # ffmpeg: composite original + mask → greenscreen
    cmd = [
        "ffmpeg",
        "-framerate", "24", "-i", os.path.join(frames_dir, "%05d.jpg"),
        "-framerate", "24", "-i", os.path.join(masks_dir, "%05d.png"),
        "-filter_complex",
        "[1:v]colorkey=black:0.1:0.1[mask];[0:v][mask]overlay=format=auto,chromakey=green",
        "-c:v", "libx264", output_path, "-y"
    ]
    subprocess.run(cmd, check=True)
```

---

## PHASE 2 — Frontend Foundation

> **PRD Reference:** Section 8 (Stack), Section 10 (Design Tokens)

---

### 2.1 Global Styles

Create `frontend/src/styles/globals.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500&display=swap');
@import "tailwindcss";

:root {
  --bg-primary: #0a0a0f;
  --bg-surface: #111118;
  --bg-card: #1a1a24;
  --accent: #6c63ff;
  --accent-glow: rgba(108, 99, 255, 0.3);
  --text-primary: #f0f0ff;
  --text-muted: #6b6b8a;
  --success: #22c55e;
  --error: #ef4444;
  --mask-overlay: rgba(108, 99, 255, 0.4);
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'Inter', sans-serif;
}

h1, h2, h3, .display {
  font-family: 'Space Grotesk', sans-serif;
}
```

---

### 2.2 API Client

Create `frontend/src/api/client.js`:

```js
const BASE = "/api"

export const api = {
  upload: async (file) => {
    const form = new FormData()
    form.append("file", file)
    const res = await fetch(`${BASE}/upload`, { method: "POST", body: form })
    if (!res.ok) throw new Error("Upload failed")
    return res.json()
  },

  previewMask: async (session_id, points, labels) => {
    const res = await fetch(`${BASE}/preview_mask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, points, labels })
    })
    return res.json()
  },

  process: async (session_id, points, labels) => {
    const res = await fetch(`${BASE}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, points, labels })
    })
    return res.json()
  },

  exportVideo: async (session_id, mode, quality) => {
    const res = await fetch(`${BASE}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, mode, quality })
    })
    return res.json()
  }
}
```

---

### 2.3 WebSocket Hook

Create `frontend/src/hooks/useWebSocket.js`:

```js
import { useEffect, useRef, useCallback } from "react"

export const useWebSocket = (sessionId, onMessage) => {
  const wsRef = useRef(null)

  const connect = useCallback(() => {
    if (!sessionId) return
    const ws = new WebSocket(`ws://localhost:8000/ws/${sessionId}`)
    ws.onmessage = (e) => onMessage(JSON.parse(e.data))
    ws.onerror = (e) => console.error("WS error", e)
    wsRef.current = ws
  }, [sessionId, onMessage])

  useEffect(() => {
    connect()
    return () => wsRef.current?.close()
  }, [connect])
}
```

---

### 2.4 App Router

Create `frontend/src/App.jsx`:

```jsx
import { BrowserRouter, Routes, Route } from "react-router-dom"
import Home from "./pages/Home"
import Canvas from "./pages/Canvas"
import Processing from "./pages/Processing"
import Export from "./pages/Export"
import Navbar from "./components/Navbar"
import "./styles/globals.css"

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ background: "var(--bg-primary)", minHeight: "100vh" }}>
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/canvas/:sessionId" element={<Canvas />} />
          <Route path="/processing/:sessionId" element={<Processing />} />
          <Route path="/export/:sessionId" element={<Export />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
```

---

## PHASE 3 — Build Each Screen

> **PRD Reference:** Section 4 (App Screens)
> Build screens in order: Home → Canvas → Processing → Export

---

### 3.1 Screen 1 — Home (PRD §4.1)

File: `frontend/src/pages/Home.jsx`

**Build requirements:**
- Dark cinematic hero layout
- Drag & drop zone using HTML5 drag events (not a library)
- On file drop/select → call `api.upload(file)` → navigate to `/canvas/{session_id}`
- Show loading spinner during upload
- Show recent sessions from localStorage (key: `rotoai_sessions`)
- Accept: `.mp4`, `.mov`, `.webm` only
- Reject files over 500MB with error toast

**State needed:**
```js
const [isDragging, setIsDragging] = useState(false)
const [uploading, setUploading] = useState(false)
const [error, setError] = useState(null)
```

---

### 3.2 Screen 2 — Canvas (PRD §4.2)

File: `frontend/src/pages/Canvas.jsx`

**Build requirements:**
- Display first frame as `<canvas>` element
- Click on canvas → add green dot (foreground point)
- Shift+Click → add red dot (background point)
- Right panel: list of all points with delete buttons
- "Preview Mask" button → call `api.previewMask()` → overlay mask (purple, 40% opacity) on canvas
- "Process Full Video" button → call `api.process()` → navigate to `/processing/{sessionId}`
- "Reset" button → clear all points and mask overlay
- Canvas must scale image to fit viewport while preserving aspect ratio
- Click coordinates must be normalized to original image dimensions before sending to API

**State needed:**
```js
const [points, setPoints] = useState([])      // [{x, y, label}]
const [maskB64, setMaskB64] = useState(null)
const [frameB64, setFrameB64] = useState(null)
const [previewing, setPreviewing] = useState(false)
```

**Key logic — coordinate normalization:**
```js
const handleCanvasClick = (e) => {
  const rect = canvasRef.current.getBoundingClientRect()
  const scaleX = originalWidth / rect.width
  const scaleY = originalHeight / rect.height
  const x = Math.round((e.clientX - rect.left) * scaleX)
  const y = Math.round((e.clientY - rect.top) * scaleY)
  const label = e.shiftKey ? 0 : 1
  setPoints(prev => [...prev, { x, y, label }])
}
```

---

### 3.3 Screen 3 — Processing (PRD §4.3)

File: `frontend/src/pages/Processing.jsx`

**Build requirements:**
- Connect WebSocket using `useWebSocket` hook
- Animated progress bar (CSS transition, not a library)
- Show "Processing frame X / Y"
- On `status: "done"` → navigate to `/export/{sessionId}`
- On `status: "error"` → show error message + "Go Back" button
- Cancel button → DELETE `/api/session/{sessionId}` → navigate to `/`
- Pulsing animated background while processing

**State needed:**
```js
const [progress, setProgress] = useState({ frame: 0, total: 0, status: "processing" })
```

---

### 3.4 Screen 4 — Export (PRD §4.4)

File: `frontend/src/pages/Export.jsx`

**Build requirements:**
- Three format cards (B&W Matte, Alpha, Greenscreen) — click to select
- Quality toggle: Draft / Full
- "Export" button → call `api.exportVideo()` → poll for download URL
- Download link button when ready
- "Start New Session" → navigate to `/`
- Show preview of output (video element with masked result)

---

## PHASE 4 — Polish & Connect

### 4.1 Fix ffmpeg export commands

In `backend/routers/export.py`, complete `_export_greenscreen` with correct ffmpeg filtergraph for proper mask compositing:

```python
def _export_greenscreen(frames_dir, masks_dir, output_path, fps=24):
    cmd = [
        "ffmpeg",
        "-framerate", str(fps), "-i", os.path.join(frames_dir, "%05d.jpg"),
        "-framerate", str(fps), "-i", os.path.join(masks_dir, "%05d.png"),
        "-filter_complex",
        "[1:v]format=gray[mask];[0:v][mask]alphamerge[rgba];[rgba]colorchannelmixer=0:0:0:0:0:0:0:0:0:0:0:0[bg];color=green:size=1920x1080[green];[green][bg]overlay",
        "-c:v", "libx264", output_path, "-y"
    ]
    subprocess.run(cmd, check=True)
```

### 4.2 Add fps to session metadata

After upload, save metadata JSON:
```python
import json
metadata = {"fps": info["fps"], "total_frames": total_frames, "width": w, "height": h}
with open(os.path.join(session_path, "meta.json"), "w") as f:
    json.dump(metadata, f)
```
Load this in export router to use correct fps.

### 4.3 CORS for production build

When serving React build from FastAPI, update CORS to allow same-origin. Update `main.py` to also serve built React:
```python
# After npm run build, copy frontend/dist → backend/dist
app.mount("/", StaticFiles(directory="./dist", html=True), name="frontend")
```

---

## PHASE 5 — Run & Test

### 5.1 Start Backend

```bash
cd backend
source venv/bin/activate  # or venv\Scripts\activate on Windows
python main.py
# Server running at http://localhost:8000
# Gradio debug UI at http://localhost:8000/gradio
```

### 5.2 Start Frontend (dev)

```bash
cd frontend
npm run dev
# App running at http://localhost:5173
```

### 5.3 Test Checklist

```
[ ] Upload a short video (5-10 sec, mp4)
[ ] First frame appears on Canvas screen
[ ] Click adds green dot on canvas
[ ] Shift+Click adds red dot
[ ] "Preview Mask" shows purple overlay on subject
[ ] "Process Full Video" starts processing
[ ] Progress bar increments in real-time
[ ] Processing completes and navigates to Export
[ ] B&W Matte export downloads correctly
[ ] Greenscreen export downloads correctly
[ ] Session cleanup happens (check /tmp/sessions after 2hrs or manually delete)
```

### 5.4 Build for Production

```bash
cd frontend
npm run build
# Copy dist/ to backend/dist/
cp -r dist ../backend/dist

cd ../backend
python main.py
# Full app now at http://localhost:8000
```

---

## Quick Reference — Key Files

| File | What it does | PRD Section |
|---|---|---|
| `backend/main.py` | App entry, mounts all routers + Gradio | §5 |
| `backend/services/sam2_service.py` | All SAM 2 inference | §6 |
| `backend/services/ffmpeg_service.py` | Frame extraction, export compositing | §6 |
| `backend/websocket_manager.py` | Real-time progress streaming | §4.3 |
| `backend/routers/upload.py` | POST /api/upload | §4.1 |
| `backend/routers/mask.py` | POST /api/preview_mask | §4.2 |
| `backend/routers/process.py` | POST /api/process + background task | §4.3 |
| `backend/routers/export.py` | POST /api/export + download | §4.4 |
| `frontend/src/api/client.js` | All API calls from React | §5 |
| `frontend/src/hooks/useWebSocket.js` | WebSocket progress hook | §4.3 |
| `frontend/src/pages/Canvas.jsx` | Click-to-select UI | §4.2 |
| `frontend/src/pages/Processing.jsx` | Progress screen | §4.3 |
