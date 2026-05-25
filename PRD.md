# RotoAI — Product Requirements Document (PRD)

> **Version:** 1.0  
> **Author:** Pankoj (Uchiha-Itachi001)  
> **Stack:** React (Vite) + FastAPI + SAM 2 + MatAnyone  
> **Purpose:** Web-based AI rotoscoping / masking tool — free alternative to DaVinci Resolve Magic Mask  

---

## 1. Product Overview

RotoAI is a web application that lets users isolate subjects from video clips using AI. The user uploads a video, clicks on the subject in the first frame, and the app automatically tracks and generates a mask across all frames. The output can be exported as a B&W matte, alpha channel video, or greenscreen composite.

The architecture is:
- **React (Vite)** — cinematic dark UI, all user interactions
- **FastAPI (Python)** — REST API, session management, file handling
- **Gradio** — mounted inside FastAPI as ML inference wrapper (dev + debug layer)
- **SAM 2** (Meta) — segmentation + mask propagation across frames
- **MatAnyone** — optional human matting for clean hair/edge alpha

---

## 2. Goals

- Ship a working web-based rotoscoping tool with a polished UI
- Run fully locally (no cloud API costs)
- Support Windows (primary), Linux, Mac
- Be portfolio-worthy — not a Gradio default UI clone
- Be buildable by an AI coding agent (vibe code friendly — all steps explicit)

---

## 3. Out of Scope (v1)

- User accounts / auth
- Cloud deployment
- Real-time webcam input
- Mobile support
- Batch processing of multiple videos

---

## 4. App Screens & Features

### 4.1 Screen 1 — Home / Upload

**Purpose:** Entry point. User uploads a video clip.

**Elements:**
- App name + tagline ("AI Masking. No Studio Required.")
- Drag & drop video upload zone (accepts `.mp4`, `.mov`, `.webm`)
- Max file size warning (500MB)
- Recent sessions list (stored in localStorage)
- "New Session" CTA button

**Behavior:**
- On upload → POST `/api/upload` with FormData
- Backend extracts first frame, returns `{ session_id, first_frame_url, total_frames, fps }`
- Navigate to Screen 2 automatically

---

### 4.2 Screen 2 — Frame Canvas (Subject Selection)

**Purpose:** User clicks on the subject to prompt SAM 2.

**Elements:**
- Full canvas showing first frame of video
- Click = green dot (foreground point)
- Right-click or Shift+click = red dot (background / exclusion point)
- "Draw Box" toggle — drag a bounding box instead of points
- Point list sidebar (shows all added points, can delete)
- "Preview Mask" button → calls `/api/preview_mask`
- Mask overlay displayed in real-time (semi-transparent green over subject)
- "Looks Good → Process Full Video" CTA
- "Reset Points" button

**Behavior:**
- Points stored in React state as `[{ x, y, label }]` (label: 1=fg, 0=bg)
- Preview mask: POST `/api/preview_mask` → returns mask PNG for frame 0
- Full process: POST `/api/process` → starts background job, navigates to Screen 3

---

### 4.3 Screen 3 — Processing / Progress

**Purpose:** Show real-time progress while SAM 2 propagates mask across all frames.

**Elements:**
- Animated progress bar
- Frame counter ("Processing frame 47 / 120")
- Live frame preview (current frame being processed with mask overlay)
- Cancel button
- Estimated time remaining

**Behavior:**
- WebSocket connection to `ws://localhost:8000/ws/{session_id}`
- Backend streams progress events: `{ frame, total, preview_url, status }`
- On `status: "done"` → navigate to Screen 4
- On `status: "error"` → show error toast, back to Screen 2

---

### 4.4 Screen 4 — Export

**Purpose:** Preview result and export in chosen format.

**Elements:**
- Side-by-side preview: Original | Masked
- Export format selector:
  - B&W Matte (white subject, black background)
  - Alpha Channel (transparent background, `.webm` or `.mov`)
  - Greenscreen (subject on solid green background)
- Quality selector: Draft (fast) / Full (slow)
- "Export" button → POST `/api/export`
- Download link when ready
- "Start New Session" button

---

## 5. API Endpoints

| Method | Route | Description |
|---|---|---|
| POST | `/api/upload` | Upload video, create session, extract frame 0 |
| POST | `/api/preview_mask` | SAM 2 on single frame with given points |
| POST | `/api/process` | Start full video mask propagation (async) |
| WS | `/ws/{session_id}` | Stream progress events |
| POST | `/api/export` | Render final output in chosen format |
| GET | `/api/download/{session_id}` | Download exported file |
| DELETE | `/api/session/{session_id}` | Cleanup temp files |
| GET | `/gradio` | Gradio debug UI (dev only) |

---

## 6. Data Flow

```
User uploads video
    → FastAPI saves to /tmp/sessions/{session_id}/input.mp4
    → ffmpeg extracts frames to /tmp/sessions/{session_id}/frames/
    → Returns first frame as base64 or static URL

User clicks points on canvas
    → React stores [{x, y, label}]
    → POST /api/preview_mask → SAM 2 single frame inference
    → Returns mask PNG → React overlays on canvas

User confirms → POST /api/process
    → FastAPI spawns background task
    → SAM 2 video predictor propagates across all frames
    → WebSocket streams progress to React
    → Masks saved as PNGs in /tmp/sessions/{session_id}/masks/

User exports
    → FastAPI + ffmpeg composites original + masks
    → Output saved to /tmp/sessions/{session_id}/output.*
    → Download link returned
```

---

## 7. Session Management

- Each upload gets a UUID `session_id`
- Temp files stored at `/tmp/rotoai_sessions/{session_id}/`
- Sessions auto-deleted after 2 hours (background cleanup task)
- Max 1 active processing job at a time (v1 — single user local app)

---

## 8. Tech Stack Summary

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TailwindCSS |
| Canvas interaction | Fabric.js or plain Canvas API |
| Backend | FastAPI (Python 3.11+) |
| ML inference wrapper | Gradio (mounted inside FastAPI) |
| Segmentation | SAM 2.1 (facebook/sam2) |
| Human matting | MatAnyone (optional, toggle in settings) |
| Video processing | ffmpeg (via subprocess / ffmpeg-python) |
| WebSocket | FastAPI WebSockets (built-in) |
| File storage | Local filesystem (tmp) |

---

## 9. Non-Functional Requirements

- Minimum 6GB VRAM Nvidia GPU recommended
- CPU fallback supported (slower)
- SAM 2 Base+ model used by default (balance of speed/accuracy)
- SAM 2 Large model optional (better accuracy, more VRAM)
- Frame extraction capped at original FPS (no upsampling)
- Export video codec: H.264 (mp4) or VP9 (webm for alpha)

---

## 10. UI Design Tokens

```css
--bg-primary: #0a0a0f
--bg-surface: #111118
--bg-card: #1a1a24
--accent: #6c63ff
--accent-glow: rgba(108, 99, 255, 0.3)
--text-primary: #f0f0ff
--text-muted: #6b6b8a
--success: #22c55e
--error: #ef4444
--mask-overlay: rgba(108, 99, 255, 0.4)
--font-display: 'Space Grotesk', sans-serif
--font-body: 'Inter', sans-serif
```

---

## 11. File Structure (Final)

```
rotoai/
├── backend/
│   ├── main.py                  # FastAPI app entry
│   ├── routers/
│   │   ├── upload.py
│   │   ├── mask.py
│   │   ├── process.py
│   │   └── export.py
│   ├── services/
│   │   ├── sam2_service.py      # SAM 2 inference logic
│   │   ├── matanyone_service.py
│   │   ├── ffmpeg_service.py
│   │   └── session_service.py
│   ├── gradio_app.py            # Gradio interface (mounted)
│   ├── websocket_manager.py     # WebSocket progress streaming
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Home.jsx
│   │   │   ├── Canvas.jsx
│   │   │   ├── Processing.jsx
│   │   │   └── Export.jsx
│   │   ├── components/
│   │   │   ├── VideoUploader.jsx
│   │   │   ├── FrameCanvas.jsx
│   │   │   ├── ProgressBar.jsx
│   │   │   ├── ExportPanel.jsx
│   │   │   └── Navbar.jsx
│   │   ├── hooks/
│   │   │   ├── useSession.js
│   │   │   └── useWebSocket.js
│   │   ├── api/
│   │   │   └── client.js        # All fetch calls
│   │   └── styles/
│   │       └── globals.css
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
└── README.md
```
