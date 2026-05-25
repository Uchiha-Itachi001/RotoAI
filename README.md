# RotoAI 🎬

> **AI-powered video rotoscoping and masking — free alternative to DaVinci Resolve Magic Mask**

RotoAI lets you isolate subjects from video clips using Meta's SAM 2. Upload a video, click on the subject in the first frame, and the AI automatically tracks and generates a mask across all frames.

---

## ✨ Features

- **Click-to-mask** — SAM 2 generates instant masks from point or bounding box prompts
- **Full video propagation** — AI tracks the subject across every frame
- **3 export formats** — B&W Matte, Alpha Channel (WebM/MOV), Greenscreen composite
- **Real-time progress** — WebSocket-driven progress bar while processing
- **100% local** — your video never leaves your machine
- **Cinematic dark UI** — built with React + Vite + TailwindCSS v4

---

## 🖥 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TailwindCSS v4 |
| Backend | FastAPI (Python 3.11+) |
| ML Inference | SAM 2.1 (Meta) |
| Debug UI | Gradio (at `/gradio`) |
| Video | ffmpeg |
| Real-time | WebSocket (FastAPI built-in) |

---

## 📋 Requirements

- Python 3.10 or 3.11
- Node.js 18+
- ffmpeg on PATH
- (Optional but recommended) NVIDIA GPU with 6GB+ VRAM

---

## 🚀 Setup

### 1. Clone and navigate

```bash
git clone <repo-url>
cd RotoAI
```

### 2. Backend setup

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate
# Linux/Mac
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Install SAM 2 (from source)

```bash
pip install git+https://github.com/facebookresearch/sam2.git
```

### 4. Download SAM 2 checkpoint

```bash
mkdir checkpoints

# Windows (PowerShell)
Invoke-WebRequest -Uri "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt" -OutFile "checkpoints/sam2.1_hiera_base_plus.pt"

# Linux/Mac
wget -P checkpoints https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt
```

Optionally download the Large model (higher accuracy, more VRAM):
```bash
# Windows
Invoke-WebRequest -Uri "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt" -OutFile "checkpoints/sam2.1_hiera_large.pt"

# Linux/Mac
wget -P checkpoints https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt
```

If using Large model, update `backend/.env`:
```env
SAM2_CHECKPOINT=./checkpoints/sam2.1_hiera_large.pt
SAM2_MODEL_CFG=configs/sam2.1/sam2.1_hiera_l.yaml
```

### 5. Frontend setup

```bash
cd ../frontend
npm install
```

---

## ▶ Running (Development)

**Terminal 1 — Backend:**
```bash
cd backend
venv\Scripts\activate   # or: source venv/bin/activate
python main.py
# API: http://localhost:8000
# Gradio debug: http://localhost:8000/gradio
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# App: http://localhost:5173
```

---

## 📦 Production Build

```bash
cd frontend
npm run build
# Copy dist/ into backend/
xcopy /E /I dist ..\backend\dist   # Windows
# OR
cp -r dist ../backend/dist          # Linux/Mac

cd ../backend
python main.py
# Full app at: http://localhost:8000
```

---

## 🗂 Project Structure

```
RotoAI/
├── backend/
│   ├── main.py                    # FastAPI entry point
│   ├── gradio_app.py              # Debug UI at /gradio
│   ├── websocket_manager.py       # Real-time progress streaming
│   ├── requirements.txt
│   ├── .env                       # Configuration
│   ├── checkpoints/               # SAM 2 model weights (you download these)
│   ├── routers/
│   │   ├── upload.py              # POST /api/upload
│   │   ├── mask.py                # POST /api/preview_mask
│   │   ├── process.py             # POST /api/process, DELETE /api/session
│   │   └── export.py              # POST /api/export, GET /api/download
│   └── services/
│       ├── sam2_service.py        # SAM 2 inference (single frame + video)
│       ├── ffmpeg_service.py      # Frame extraction + export compositing
│       ├── session_service.py     # Session management + cleanup
│       └── matanyone_service.py   # MatAnyone stub (future)
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── main.jsx
    │   ├── pages/
    │   │   ├── Home.jsx           # Upload screen
    │   │   ├── Canvas.jsx         # Subject selection screen
    │   │   ├── Processing.jsx     # Progress screen
    │   │   └── Export.jsx         # Export & download screen
    │   ├── components/
    │   │   ├── Navbar.jsx
    │   │   ├── VideoUploader.jsx
    │   │   ├── FrameCanvas.jsx    # Canvas with click-to-point
    │   │   ├── ProgressBar.jsx
    │   │   └── ExportPanel.jsx
    │   ├── hooks/
    │   │   ├── useWebSocket.js    # Auto-reconnect WS hook
    │   │   └── useSession.js      # Session + localStorage hook
    │   └── api/client.js          # All fetch calls
    ├── vite.config.js
    └── index.html
```

---

## 🔧 Configuration (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `SAM2_CHECKPOINT` | `./checkpoints/sam2.1_hiera_base_plus.pt` | SAM 2 model weights path |
| `SAM2_MODEL_CFG` | `configs/sam2.1/sam2.1_hiera_b+.yaml` | SAM 2 config file |
| `SESSIONS_DIR` | `./tmp/sessions` | Temp session storage directory |
| `MAX_SESSION_AGE_HOURS` | `2` | Sessions are deleted after this many hours |
| `MAX_UPLOAD_SIZE_MB` | `500` | Maximum upload size |
| `PORT` | `8000` | FastAPI server port |

---

## 🔍 Notes

- **No SAM 2 installed?** The backend runs in **Demo Mode** — a fake elliptical mask is generated so you can test the UI flow end-to-end without GPU hardware.
- **ffmpeg required** — install from https://ffmpeg.org/download.html and add to PATH. On Windows: `winget install ffmpeg`
- **MatAnyone** is stubbed out and ready to integrate for high-quality hair matting.

---

## 📄 API Reference

| Method | Route | Description |
|---|---|---|
| POST | `/api/upload` | Upload video, extract frames |
| POST | `/api/preview_mask` | SAM 2 on frame 0 |
| POST | `/api/process` | Start full video processing |
| DELETE | `/api/session/{id}` | Cancel + delete session |
| POST | `/api/export` | Render output video |
| GET | `/api/export/status/{id}` | Poll export status |
| GET | `/api/download/{id}/{mode}` | Download exported video |
| WS | `/ws/{session_id}` | Real-time progress stream |
| GET | `/gradio` | Gradio debug UI |
