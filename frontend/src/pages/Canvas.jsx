import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import FrameCanvas from '../components/FrameCanvas'
import BackendStatus from '../components/BackendStatus'
import { api, getApiUrl } from '../api/client'

// Debounce hook
function useDebounce(fn, delay) {
  const timer = useRef(null)
  return useCallback((...args) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), delay)
  }, [fn, delay])
}

export default function Canvas() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const sessionData = location.state?.session || null

  // Frame details
  const [frameB64, setFrameB64]     = useState(sessionData?.firstFrameB64 || null)
  const [overlayB64, setOverlayB64] = useState(null)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [totalFrames, setTotalFrames] = useState(sessionData?.total_frames || 120)
  const [fps, setFps] = useState(sessionData?.fps || 24)
  const [videoWidth, setVideoWidth] = useState(sessionData?.width || 1920)
  const [videoHeight, setVideoHeight] = useState(sessionData?.height || 1080)
  const [originalFilename, setOriginalFilename] = useState(sessionData?.original_filename || "Video Clip")

  // Auto-follow toggle state + ref for websocket thread safety
  const [autoFollow, _setAutoFollow] = useState(true)
  const autoFollowRef = useRef(true)
  const setAutoFollow = (val) => {
    _setAutoFollow(val)
    autoFollowRef.current = val
  }

  // Modes and styles
  const [activeToolMode, setActiveToolMode] = useState("add") // add | subtract | paintAdd | paintSubtract
  const [brushSize, setBrushSize] = useState(15)
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [overlayMode, setOverlayMode] = useState("rubylith") // rubylith | color | highlight | outline | bw
  const [qualityMode, setQualityMode] = useState("faster") // faster | better
  const [drawingBox, setDrawingBox] = useState(false)

  // Prompts and history
  const [framePrompts, setFramePrompts] = useState({}) // { [frameIdx]: { points, labels, box, strokes } }
  const [historyStack, setHistoryStack] = useState([]) // [{ frame, type: 'point'|'stroke'|'box', index }]

  // UI state
  const [previewing, setPreviewing] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [trackingProgress, setTrackingProgress] = useState({ frame: 0, total: 0, speed: 0 })
  const [error, setError] = useState(null)
  const [activeHoverItem, setActiveHoverItem] = useState(null) // { type: 'point'|'stroke', index }

  // Finesse sliders state
  const [finesse, setFinesse] = useState({
    smoothing: 0,
    denoise: 0,
    consistency: 30,
    blurRadius: 0,
    edgeExpand: 0,
    cleanBlack: 0,
    cleanWhite: 0,
    inOutRatio: 0,
    smartRefine: false,
    inverted: false
  })

  const wsRef = useRef(null)

  const [modelStatus, setModelStatus] = useState({ active_model: "Loading...", is_demo: true })

  const fetchModelStatus = useCallback(async () => {
    try {
      const data = await api.getModelStatus()
      setModelStatus(data)
    } catch (err) {
      console.error("Error fetching model status:", err)
    }
  }, [])

  useEffect(() => {
    fetchModelStatus()
    const interval = setInterval(fetchModelStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchModelStatus])

  // Fetch session details on mount to restore state if location state is missing
  useEffect(() => {
    api.getSession(sessionId)
      .then(data => {
        if (data.total_frames) setTotalFrames(data.total_frames)
        if (data.fps) setFps(data.fps)
        if (data.width) setVideoWidth(data.width)
        if (data.height) setVideoHeight(data.height)
        if (data.original_filename) setOriginalFilename(data.original_filename)
      })
      .catch(err => {
        console.error("Error loading session metadata:", err)
      })
  }, [sessionId])

  // ── Load Frame & Mask ──────────────────────────────────────────────────────
  const loadFrame = useCallback(async (fIdx) => {
    try {
      const data = await api.getFrame(sessionId, fIdx)
      setFrameB64(data.frame_b64)
      setOverlayB64(data.overlay_b64)
    } catch (err) {
      setError(err.message)
    }
  }, [sessionId])

  useEffect(() => {
    loadFrame(currentFrame)
  }, [currentFrame, loadFrame])

  // ── Preview mask triggers ──────────────────────────────────────────────────
  const runPreview = useCallback(async (fIdx, pts, lbls, b, strks, fParams, oMode) => {
    setPreviewing(true)
    setError(null)
    try {
      const coords = pts.map(p => [p.x, p.y])
      const res = await api.previewMask(
        sessionId,
        fIdx,
        coords,
        lbls,
        strks,
        b || null,
        fParams,
        oMode
      )
      setOverlayB64(res.overlay_b64)
    } catch (err) {
      setError(err.message)
    } finally {
      setPreviewing(false)
    }
  }, [sessionId])

  const debouncedPreview = useDebounce(runPreview, 250)

  const updatePromptsAndPreview = (nextPrompt) => {
    setFramePrompts(prev => {
      const updated = { ...prev, [currentFrame]: nextPrompt }
      debouncedPreview(
        currentFrame,
        nextPrompt.points || [],
        nextPrompt.labels || [],
        nextPrompt.box || null,
        nextPrompt.strokes || [],
        finesse,
        overlayMode
      )
      return updated
    })
  }

  // ── Finesse Update trigger ────────────────────────────────────────────────
  const runFinesseAPI = useCallback(async (fParams, oMode, fIdx) => {
    try {
      const res = await api.finesseMask(sessionId, fIdx, fParams, oMode)
      setOverlayB64(res.overlay_b64)
    } catch (err) {
      setError(err.message)
    }
  }, [sessionId])

  const debouncedFinesse = useDebounce(runFinesseAPI, 150)

  const handleFinesseChange = (key, val) => {
    setFinesse(prev => {
      const next = { ...prev, [key]: val }
      debouncedFinesse(next, overlayMode, currentFrame)
      return next
    })
  }

  // Get current frame prompts
  const currentPrompt = framePrompts[currentFrame] || { points: [], labels: [], box: null, strokes: [] }
  const currentPoints = currentPrompt.points || []
  const currentLabels = currentPrompt.labels || []
  const currentBox = currentPrompt.box || null
  const currentStrokes = currentPrompt.strokes || []

  // ── Points and Clicks ──────────────────────────────────────────────────────
  const addPoint = useCallback((x, y, label) => {
    const nextPoints = [...currentPoints, { x, y, label }]
    const nextLabels = [...currentLabels, label]

    setHistoryStack(prev => [...prev, { frame: currentFrame, type: 'point', index: currentPoints.length }])

    updatePromptsAndPreview({
      ...currentPrompt,
      points: nextPoints,
      labels: nextLabels
    })
  }, [currentFrame, currentPrompt, currentPoints, currentLabels])

  const deletePoint = (idx) => {
    const nextPoints = currentPoints.filter((_, i) => i !== idx)
    const nextLabels = currentLabels.filter((_, i) => i !== idx)
    setHistoryStack(prev => prev.filter(h => !(h.frame === currentFrame && h.type === 'point' && h.index === idx)))
    updatePromptsAndPreview({
      ...currentPrompt,
      points: nextPoints,
      labels: nextLabels
    })
  }

  // ── Paint Strokes ──────────────────────────────────────────────────────────
  const addStroke = useCallback((stroke) => {
    const nextStrokes = [...currentStrokes, stroke]
    setHistoryStack(prev => [...prev, { frame: currentFrame, type: 'stroke', index: currentStrokes.length }])

    updatePromptsAndPreview({
      ...currentPrompt,
      strokes: nextStrokes
    })
  }, [currentFrame, currentPrompt, currentStrokes])

  const deleteStroke = (idx) => {
    const nextStrokes = currentStrokes.filter((_, i) => i !== idx)
    setHistoryStack(prev => prev.filter(h => !(h.frame === currentFrame && h.type === 'stroke' && h.index === idx)))
    updatePromptsAndPreview({
      ...currentPrompt,
      strokes: nextStrokes
    })
  }

  // ── Box Region ─────────────────────────────────────────────────────────────
  const handleBox = useCallback((b) => {
    setHistoryStack(prev => [...prev, { frame: currentFrame, type: 'box' }])
    updatePromptsAndPreview({
      ...currentPrompt,
      box: b
    })
  }, [currentFrame, currentPrompt])

  const deleteBox = () => {
    setHistoryStack(prev => prev.filter(h => !(h.frame === currentFrame && h.type === 'box')))
    updatePromptsAndPreview({
      ...currentPrompt,
      box: null
    })
  }

  // ── Global Toolbar Actions ─────────────────────────────────────────────────
  const handleUndo = () => {
    const lastIdx = historyStack.map(h => h.frame === currentFrame).lastIndexOf(true)
    if (lastIdx === -1) return

    const lastAction = historyStack[lastIdx]
    const nextHistory = historyStack.filter((_, i) => i !== lastIdx)
    setHistoryStack(nextHistory)

    if (lastAction.type === 'point') {
      const nextPoints = currentPoints.filter((_, i) => i !== lastAction.index)
      const nextLabels = currentLabels.filter((_, i) => i !== lastAction.index)
      updatePromptsAndPreview({
        ...currentPrompt,
        points: nextPoints,
        labels: nextLabels
      })
    } else if (lastAction.type === 'stroke') {
      const nextStrokes = currentStrokes.filter((_, i) => i !== lastAction.index)
      updatePromptsAndPreview({
        ...currentPrompt,
        strokes: nextStrokes
      })
    } else if (lastAction.type === 'box') {
      updatePromptsAndPreview({
        ...currentPrompt,
        box: null
      })
    }
  }

  const clearAll = () => {
    setHistoryStack(prev => prev.filter(h => h.frame !== currentFrame))
    updatePromptsAndPreview({
      points: [],
      labels: [],
      box: null,
      strokes: []
    })
  }

  const handleInvert = () => {
    handleFinesseChange("inverted", !finesse.inverted)
  }

  // ── Frame Navigation ───────────────────────────────────────────────────────
  const stepFrame = (offset) => {
    setAutoFollow(false)
    const nextFrame = Math.max(0, Math.min(totalFrames - 1, currentFrame + offset))
    setCurrentFrame(nextFrame)
  }

  // ── Video Tracking ─────────────────────────────────────────────────────────
  const handleTrack = async (dir) => {
    if (tracking) return
    setError(null)
    setTracking(true)
    // Keep auto-follow enabled when clicking track
    setAutoFollow(true)
    setTrackingProgress({ frame: currentFrame, total: totalFrames, speed: 0 })

    const base = getApiUrl()
    let wsUrl
    if (base) {
      const wsProtocol = base.startsWith('https:') ? 'wss:' : 'ws:'
      const cleanBase = base.replace(/^https?:\/\//, '')
      wsUrl = `${wsProtocol}//${cleanBase}/ws/${sessionId}`
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.hostname
      const port = import.meta.env.DEV ? '8000' : window.location.port
      wsUrl = `${protocol}//${host}:${port}/ws/${sessionId}`
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    const trackStartTime = Date.now()

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.status === 'processing') {
          const elapsed = (Date.now() - trackStartTime) / 1000
          const processedCount = Math.abs(data.frame - currentFrame)
          const speed = elapsed > 0 ? processedCount / elapsed : 0

          setTrackingProgress({
            frame: data.frame,
            total: data.total,
            speed: parseFloat(speed.toFixed(1))
          })

          // Update frame view in real time if auto-follow is active
          if (autoFollowRef.current) {
            setCurrentFrame(data.frame)
            loadFrame(data.frame)
          }
        } else if (data.status === 'done') {
          setTracking(false)
          ws.close()
          loadFrame(currentFrame)
        } else if (data.status === 'error') {
          setError(data.message || 'Tracking failed')
          setTracking(false)
          ws.close()
        }
      } catch (e) {
        console.error("WS parse error:", e)
      }
    }

    ws.onerror = (err) => {
      setError("Websocket connection error during tracking.")
      setTracking(false)
    }

    try {
      await api.process(sessionId, dir, currentFrame)
    } catch (err) {
      setError(err.message)
      setTracking(false)
      ws.close()
    }
  }

  const cancelTracking = async () => {
    if (wsRef.current) wsRef.current.close()
    setTracking(false)
    try {
      await api.deleteSession(sessionId)
    } catch {}
    setError("Tracking canceled by user.")
  }

  const handleQualityChange = (mode) => {
    if (mode === qualityMode) return
    if (window.confirm("Changing quality will clear all tracking data. Proceed?")) {
      setQualityMode(mode)
      clearAll()
    }
  }

  // ── Keyboard Shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      const key = e.key.toLowerCase()
      if (key === 'a') {
        setActiveToolMode('add')
        setDrawingBox(false)
      } else if (key === 's') {
        setActiveToolMode('subtract')
        setDrawingBox(false)
      } else if (key === 'b') {
        setActiveToolMode('paintAdd')
        setDrawingBox(false)
      } else if (key === 'x') {
        setActiveToolMode('paintSubtract')
        setDrawingBox(false)
      } else if (key === 'i') {
        handleInvert()
      } else if (key === 'o' || e.key === '~') {
        setOverlayVisible(prev => !prev)
      } else if (key === 'z' && e.ctrlKey) {
        e.preventDefault()
        handleUndo()
      } else if (e.key === 'Enter' || key === 't') {
        e.preventDefault()
        handleTrack("forward")
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        stepFrame(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        stepFrame(1)
      } else if (e.key === '[') {
        setBrushSize(prev => Math.max(2, prev - 2))
      } else if (e.key === ']') {
        setBrushSize(prev => Math.min(100, prev + 2))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [brushSize, activeToolMode, currentFrame, totalFrames, finesse, overlayMode])

  // Keyframes showing correction markers on timeline scrubber
  const keyframes = Object.keys(framePrompts)
    .map(Number)
    .filter(fIdx => {
      const p = framePrompts[fIdx]
      return p && ((p.points && p.points.length > 0) || p.box || (p.strokes && p.strokes.length > 0))
    })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#070709', color: '#f0f0ff' }}>
      
      {/* ── Navbar ── */}
      <div style={{
        height: 52, borderBottom: '1px solid rgba(108, 99, 255, 0.1)', background: 'rgba(17, 17, 24, 0.85)',
        backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, zIndex: 10,
      }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => navigate('/')}
          style={{ padding: '6px 10px', color: '#6b6b8a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>

        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)', background: 'linear-gradient(90deg, #a78bfa, #6c63ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          RotoAI Magic Mask
        </span>

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />

        <span style={{ fontSize: 12, color: '#6b6b8a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
          {originalFilename}
        </span>

        <BackendStatus />

        {/* Model Status Indicator */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'rgba(255,255,255,0.03)', borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.06)', padding: '4px 12px',
          fontSize: 11, color: modelStatus.is_demo ? '#ef4444' : '#22c55e',
          fontWeight: 600,
          boxShadow: modelStatus.is_demo ? 'none' : '0 0 8px rgba(34,197,94,0.15)',
          marginRight: 8
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: modelStatus.is_demo ? '#ef4444' : '#22c55e',
            display: 'inline-block'
          }} />
          <span>Model: {modelStatus.active_model}</span>
        </div>

        {/* Quality capsule */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', padding: 2 }}>
          {['faster', 'better'].map(m => (
            <button
              key={m}
              onClick={() => handleQualityChange(m)}
              style={{
                padding: '3px 12px', borderRadius: 18, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
                background: qualityMode === m ? 'var(--accent)' : 'transparent',
                color: qualityMode === m ? '#fff' : '#6b6b8a',
                transition: 'all 0.15s',
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <button
          className="btn btn-primary btn-sm"
          onClick={() => navigate(`/export/${sessionId}`, { state: { session: sessionData } })}
          style={{ fontSize: 12, padding: '5px 12px', background: 'linear-gradient(135deg, #8b5cf6, #6c63ff)' }}
        >
          Export Node
        </button>
      </div>

      {/* ── Main Workspace ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        
        {/* Left Side Vertical Toolbar (DaVinci Magic Mask style) */}
        <div style={{
          width: 52, borderRight: '1px solid rgba(108, 99, 255, 0.1)', background: 'rgba(15, 15, 22, 0.95)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 0', gap: 12, zIndex: 10
        }}>
          {/* Add Click Tool */}
          <button
            onClick={() => { setActiveToolMode('add'); setDrawingBox(false) }}
            style={{
              width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
              background: (activeToolMode === 'add' && !drawingBox) ? 'rgba(34,197,94,0.15)' : 'transparent',
              color: (activeToolMode === 'add' && !drawingBox) ? '#22c55e' : '#6b6b8a',
            }}
            title="Add Click Tool (A)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
          </button>

          {/* Subtract Click Tool */}
          <button
            onClick={() => { setActiveToolMode('subtract'); setDrawingBox(false) }}
            style={{
              width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
              background: (activeToolMode === 'subtract' && !drawingBox) ? 'rgba(239,68,68,0.15)' : 'transparent',
              color: (activeToolMode === 'subtract' && !drawingBox) ? '#ef4444' : '#6b6b8a',
            }}
            title="Subtract Click Tool (S)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          </button>

          {/* Bounding Box Selector Preview */}
          <button
            onClick={() => setDrawingBox(prev => !prev)}
            style={{
              width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
              background: drawingBox ? 'rgba(108,99,255,0.15)' : 'transparent',
              color: drawingBox ? '#a78bfa' : '#6b6b8a',
            }}
            title="Bounding Box Selector"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 2"/></svg>
          </button>

          <div style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.06)' }} />

          {/* Paint Add Brush */}
          <button
            onClick={() => { setActiveToolMode('paintAdd'); setDrawingBox(false) }}
            style={{
              width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
              background: activeToolMode === 'paintAdd' ? 'rgba(34,197,94,0.15)' : 'transparent',
              color: activeToolMode === 'paintAdd' ? '#22c55e' : '#6b6b8a',
            }}
            title="Paint Add Brush (B)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13l-6 6M2 22l10-10M21 3a3 3 0 1 0-4-4L6 10l4 4L21 3z"/></svg>
          </button>

          {/* Paint Subtract Eraser */}
          <button
            onClick={() => { setActiveToolMode('paintSubtract'); setDrawingBox(false) }}
            style={{
              width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
              background: activeToolMode === 'paintSubtract' ? 'rgba(239,68,68,0.15)' : 'transparent',
              color: activeToolMode === 'paintSubtract' ? '#ef4444' : '#6b6b8a',
            }}
            title="Paint Eraser (X)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9"/></svg>
          </button>

          <div style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.06)' }} />

          {/* Undo */}
          <button
            onClick={handleUndo}
            disabled={historyStack.filter(h => h.frame === currentFrame).length === 0}
            style={{
              width: 36, height: 36, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
              color: '#6b6b8a', opacity: historyStack.filter(h => h.frame === currentFrame).length === 0 ? 0.3 : 1
            }}
            title="Undo Last Action (Ctrl+Z)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
          </button>

          {/* Clear Frame */}
          <button
            onClick={clearAll}
            disabled={currentPoints.length === 0 && !currentBox && currentStrokes.length === 0}
            style={{
              width: 36, height: 36, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
              color: '#6b6b8a', opacity: (currentPoints.length === 0 && !currentBox && currentStrokes.length === 0) ? 0.3 : 1
            }}
            title="Clear Frame Clicks & Strokes"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>

          <div style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.06)' }} />

          {/* Invert Selection */}
          <button
            onClick={handleInvert}
            style={{
              width: 36, height: 36, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
              color: finesse.inverted ? '#a78bfa' : '#6b6b8a',
            }}
            title="Invert Selection Mask (I)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20Z" fill="currentColor"/></svg>
          </button>

          {/* Toggle Overlay */}
          <button
            onClick={() => setOverlayVisible(prev => !prev)}
            style={{
              width: 36, height: 36, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
              color: overlayVisible ? '#a78bfa' : '#6b6b8a',
            }}
            title="Toggle Mask Overlay (O)"
          >
            {overlayVisible ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            )}
          </button>
        </div>

        {/* Canvas Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#050507', position: 'relative', overflow: 'hidden' }}>
          
          {/* Top Options Bar (Contextual Settings) */}
          <div style={{
            height: 38, borderBottom: '1px solid rgba(255,255,255,0.03)', background: 'rgba(10, 10, 15, 0.4)',
            display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, zIndex: 5
          }}>
            {/* Active brush size slider */}
            {(activeToolMode === 'paintAdd' || activeToolMode === 'paintSubtract') ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#6b6b8a', fontWeight: 600 }}>Brush Size</span>
                <input
                  type="range"
                  min="2"
                  max="100"
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  style={{ width: 80, height: 3, cursor: 'pointer', accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: 11, color: '#a78bfa', fontFamily: 'monospace', width: 28 }}>{brushSize}px</span>
              </div>
            ) : (
              <span style={{ fontSize: 11, color: '#6b6b8a', fontWeight: 600 }}>
                {activeToolMode === 'add' ? 'Add Mode (Click on subject)' : 'Subtract Mode (Click to exclude)'}
              </span>
            )}

            <div style={{ flex: 1 }} />

            {/* Overlay Mode Capsule */}
            <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.03)', padding: 2, borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
              {[
                { mode: 'rubylith', label: 'Rubylith' },
                { mode: 'color', label: 'Purple' },
                { mode: 'highlight', label: 'Highlight' },
                { mode: 'outline', label: 'Outline' },
                { mode: 'bw', label: 'B&W' }
              ].map(o => (
                <button
                  key={o.mode}
                  onClick={() => { setOverlayMode(o.mode); debouncedFinesse(finesse, o.mode, currentFrame) }}
                  style={{
                    padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 600,
                    background: overlayMode === o.mode ? 'rgba(108,99,255,0.15)' : 'transparent',
                    color: overlayMode === o.mode ? '#a78bfa' : '#6b6b8a',
                    transition: 'all 0.1s'
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Canvas frame container */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            
            {/* Error notifications */}
            {error && (
              <div style={{
                position: 'absolute', top: 12, left: 16, right: 16, zIndex: 12,
                background: 'rgba(220, 38, 38, 0.95)', border: '1px solid #ef4444',
                color: '#fff', borderRadius: 8, padding: '10px 16px', fontSize: 12,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)'
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {error}
                </span>
                <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 14 }}>✕</button>
              </div>
            )}

            {/* Analyzing Indicator */}
            {previewing && (
              <div style={{
                position: 'absolute', top: 16, right: 16, zIndex: 11,
                background: 'rgba(17, 17, 24, 0.85)', backdropFilter: 'blur(8px)',
                border: '1px solid rgba(108, 99, 255, 0.2)', borderRadius: 20,
                padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8,
                color: '#a78bfa', fontSize: 11, fontWeight: 600,
                boxShadow: '0 2px 10px rgba(0,0,0,0.4)'
              }}>
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.2"/>
                  <path d="M12 2 A10 10 0 0 1 22 12" strokeLinecap="round"/>
                </svg>
                Regenerating Mask Overlay...
              </div>
            )}

            {/* Non-blocking Floating tracking progress box overlay */}
            {tracking && (
              <div style={{
                position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 20,
                background: 'rgba(17, 17, 24, 0.9)', backdropFilter: 'blur(10px)',
                border: '1px solid rgba(108, 99, 255, 0.25)', borderRadius: 12,
                padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 16,
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)', color: '#fff', fontSize: 12
              }}>
                <div style={{ position: 'relative', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg className="animate-spin" width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <circle cx="14" cy="14" r="12" stroke="rgba(255,255,255,0.05)" strokeWidth="2"/>
                    <path d="M14 2 A12 12 0 0 1 26 14" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <span style={{ position: 'absolute', fontSize: 9, fontWeight: 'bold', fontFamily: 'monospace' }}>
                    {Math.round((trackingProgress.frame / (trackingProgress.total - 1)) * 100)}%
                  </span>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600 }}>Tracking Subject...</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    Frame {trackingProgress.frame + 1} / {trackingProgress.total} ({trackingProgress.speed} fps)
                  </span>
                </div>
                
                {/* Auto-Follow Toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer', userSelect: 'none', borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 12 }}>
                  <input
                    type="checkbox"
                    checked={autoFollow}
                    onChange={(e) => setAutoFollow(e.target.checked)}
                    style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                  />
                  <span>Auto-Follow</span>
                </label>

                <button
                  onClick={cancelTracking}
                  style={{
                    padding: '4px 10px', background: 'rgba(220, 38, 38, 0.15)', border: '1px solid rgba(220, 38, 38, 0.3)',
                    color: '#ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={(e) => { e.target.style.background = 'rgba(220,38,38,0.25)' }}
                  onMouseLeave={(e) => { e.target.style.background = 'rgba(220,38,38,0.15)' }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Empty instructions */}
            {!frameB64 && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b6b8a', fontSize: 13 }}>
                Loading frame…
              </div>
            )}

            {frameB64 && currentPoints.length === 0 && !currentBox && currentStrokes.length === 0 && (
              <div style={{
                position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
                zIndex: 4, pointerEvents: 'none',
              }}>
                <div style={{
                  background: 'rgba(10, 10, 15, 0.85)', backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(108, 99, 255, 0.15)', borderRadius: 30,
                  padding: '8px 20px', display: 'flex', gap: 16, alignItems: 'center',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.5)'
                }}>
                  <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                    Left Click: Add area
                  </span>
                  <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.1)' }} />
                  <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                    Right Click / Shift Click: Exclude
                  </span>
                </div>
              </div>
            )}

            {/* Frame canvas */}
            <FrameCanvas
              frameB64={frameB64}
              overlayB64={overlayVisible ? overlayB64 : null}
              points={currentPoints}
              onAddPoint={addPoint}
              originalW={videoWidth}
              originalH={videoHeight}
              drawingBox={drawingBox}
              onBox={handleBox}
              activeToolMode={activeToolMode}
              brushSize={brushSize}
              onBrushSizeChange={setBrushSize}
              onAddStroke={addStroke}
              fillContainer
            />
          </div>
        </div>

        {/* ── Right Sidebar Panels (Formatted Sections) ── */}
        <div style={{
          width: 258, borderLeft: '1px solid rgba(108, 99, 255, 0.1)', background: 'rgba(15, 15, 22, 0.95)',
          display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden', zIndex: 6, padding: '12px'
        }}>
          {/* Box 1: Prompts List */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.01)', border: '1px solid rgba(255,255,255,0.03)',
            borderRadius: 8, display: 'flex', flexDirection: 'column', maxHeight: 180, marginBottom: 12
          }}>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 10, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Prompts List
              </span>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
              {currentPoints.length === 0 && !currentBox && currentStrokes.length === 0 && (
                <div style={{ padding: '12px 6px', textAlign: 'center', color: '#6b6b8a', fontSize: 10 }}>
                  No prompts on this frame.
                </div>
              )}

              {currentBox && (
                <div style={{
                  marginBottom: 3, padding: '4px 8px', borderRadius: 4,
                  background: 'rgba(108,99,255,0.05)', border: '1px solid rgba(108,99,255,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: 10, color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 2"/></svg>
                    BBox Region
                  </span>
                  <button style={{ background: 'none', border: 'none', color: '#6b6b8a', cursor: 'pointer', fontSize: 11 }} onClick={deleteBox}>✕</button>
                </div>
              )}

              {currentPoints.map((pt, i) => {
                const isFg = pt.label === 1
                const hoverMatch = activeHoverItem && activeHoverItem.type === 'point' && activeHoverItem.index === i
                return (
                  <div
                    key={`pt-${i}`}
                    onMouseEnter={() => setActiveHoverItem({ type: 'point', index: i })}
                    onMouseLeave={() => setActiveHoverItem(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 6px', borderRadius: 4, marginBottom: 2,
                      background: hoverMatch ? 'rgba(255,255,255,0.02)' : 'transparent',
                      border: '1px solid ' + (hoverMatch ? 'rgba(108,99,255,0.15)' : 'transparent'),
                      transition: 'all 0.1s'
                    }}
                  >
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      background: isFg ? '#22c55e' : '#ef4444',
                    }} />
                    <span style={{ flex: 1, fontSize: 10, color: '#6b6b8a', fontFamily: 'monospace' }}>
                      {isFg ? 'Add Click' : 'Sub Click'} ({pt.x}, {pt.y})
                    </span>
                    <button
                      style={{ background: 'none', border: 'none', color: '#6b6b8a', cursor: 'pointer', fontSize: 11, visibility: hoverMatch ? 'visible' : 'hidden' }}
                      onClick={() => deletePoint(i)}
                    >✕</button>
                  </div>
                )
              })}

              {currentStrokes.map((s, i) => {
                const isAdd = s.label === 1
                const hoverMatch = activeHoverItem && activeHoverItem.type === 'stroke' && activeHoverItem.index === i
                return (
                  <div
                    key={`strk-${i}`}
                    onMouseEnter={() => setActiveHoverItem({ type: 'stroke', index: i })}
                    onMouseLeave={() => setActiveHoverItem(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 6px', borderRadius: 4, marginBottom: 2,
                      background: hoverMatch ? 'rgba(255,255,255,0.02)' : 'transparent',
                      border: '1px solid ' + (hoverMatch ? 'rgba(108,99,255,0.15)' : 'transparent'),
                      transition: 'all 0.1s'
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={isAdd ? '#22c55e' : '#ef4444'} strokeWidth="2.5"><path d="M18 13l-6 6M2 22l10-10M21 3a3 3 0 1 0-4-4L6 10l4 4L21 3z"/></svg>
                    <span style={{ flex: 1, fontSize: 10, color: '#6b6b8a', fontFamily: 'monospace' }}>
                      {isAdd ? 'Paint Add' : 'Paint Sub'} ({s.points?.length || 0} pts)
                    </span>
                    <button
                      style={{ background: 'none', border: 'none', color: '#6b6b8a', cursor: 'pointer', fontSize: 11, visibility: hoverMatch ? 'visible' : 'hidden' }}
                      onClick={() => deleteStroke(i)}
                    >✕</button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Box 2: Mask Finesse Section */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.01)', border: '1px solid rgba(255,255,255,0.03)',
            borderRadius: 8, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden'
          }}>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 10, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Mask Finesse
              </span>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              
              {/* Subsection: Spatial Filters */}
              <div style={{ border: '1px solid rgba(255,255,255,0.02)', borderRadius: 6, padding: '8px', background: 'rgba(255,255,255,0.01)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.04em' }}>Spatial Filters</div>
                
                {/* Smoothing */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b6b8a', marginBottom: 2 }}>
                    <span>Smoothing</span>
                    <span style={{ fontFamily: 'monospace' }}>{finesse.smoothing}</span>
                  </div>
                  <input
                    type="range" min="0" max="100" value={finesse.smoothing}
                    onChange={(e) => handleFinesseChange("smoothing", parseInt(e.target.value))}
                    style={{ width: '100%', height: 3, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                </div>

                {/* Denoise */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b6b8a', marginBottom: 2 }}>
                    <span>Denoise</span>
                    <span style={{ fontFamily: 'monospace' }}>{finesse.denoise}</span>
                  </div>
                  <input
                    type="range" min="0" max="100" value={finesse.denoise}
                    onChange={(e) => handleFinesseChange("denoise", parseInt(e.target.value))}
                    style={{ width: '100%', height: 3, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                </div>
              </div>

              {/* Subsection: Temporal Filters */}
              <div style={{ border: '1px solid rgba(255,255,255,0.02)', borderRadius: 6, padding: '8px', background: 'rgba(255,255,255,0.01)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.04em' }}>Temporal Filters</div>
                
                {/* Consistency */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b6b8a', marginBottom: 2 }}>
                    <span>Consistency</span>
                    <span style={{ fontFamily: 'monospace' }}>{finesse.consistency}</span>
                  </div>
                  <input
                    type="range" min="0" max="100" value={finesse.consistency}
                    onChange={(e) => handleFinesseChange("consistency", parseInt(e.target.value))}
                    style={{ width: '100%', height: 3, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                </div>
              </div>

              {/* Subsection: Edge Modification */}
              <div style={{ border: '1px solid rgba(255,255,255,0.02)', borderRadius: 6, padding: '8px', background: 'rgba(255,255,255,0.01)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.04em' }}>Edge Modifiers</div>
                
                {/* Edge Expand */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b6b8a', marginBottom: 2 }}>
                    <span>Edge Expand</span>
                    <span style={{ fontFamily: 'monospace' }}>{finesse.edgeExpand > 0 ? `+${finesse.edgeExpand}` : finesse.edgeExpand}</span>
                  </div>
                  <input
                    type="range" min="-50" max="50" value={finesse.edgeExpand}
                    onChange={(e) => handleFinesseChange("edgeExpand", parseInt(e.target.value))}
                    style={{ width: '100%', height: 3, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                </div>

                {/* Blur Radius */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b6b8a', marginBottom: 2 }}>
                    <span>Blur (Feather)</span>
                    <span style={{ fontFamily: 'monospace' }}>{finesse.blurRadius}</span>
                  </div>
                  <input
                    type="range" min="0" max="100" value={finesse.blurRadius}
                    onChange={(e) => handleFinesseChange("blurRadius", parseInt(e.target.value))}
                    style={{ width: '100%', height: 3, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                </div>

                {/* In/Out Ratio */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b6b8a', marginBottom: 2 }}>
                    <span>In / Out Ratio</span>
                    <span style={{ fontFamily: 'monospace' }}>{finesse.inOutRatio}</span>
                  </div>
                  <input
                    type="range" min="-1" max="1" step="0.1" value={finesse.inOutRatio}
                    onChange={(e) => handleFinesseChange("inOutRatio", parseFloat(e.target.value))}
                    style={{ width: '100%', height: 3, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                </div>
              </div>

              {/* Subsection: Isolation Filters */}
              <div style={{ border: '1px solid rgba(255,255,255,0.02)', borderRadius: 6, padding: '8px', background: 'rgba(255,255,255,0.01)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.04em' }}>Isolation & Cleaning</div>
                
                {/* Clean Black */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b6b8a', marginBottom: 2 }}>
                    <span>Clean Black (BG)</span>
                    <span style={{ fontFamily: 'monospace' }}>{finesse.cleanBlack}</span>
                  </div>
                  <input
                    type="range" min="0" max="100" value={finesse.cleanBlack}
                    onChange={(e) => handleFinesseChange("cleanBlack", parseInt(e.target.value))}
                    style={{ width: '100%', height: 3, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                </div>

                {/* Clean White */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b6b8a', marginBottom: 2 }}>
                    <span>Clean White (Holes)</span>
                    <span style={{ fontFamily: 'monospace' }}>{finesse.cleanWhite}</span>
                  </div>
                  <input
                    type="range" min="0" max="100" value={finesse.cleanWhite}
                    onChange={(e) => handleFinesseChange("cleanWhite", parseInt(e.target.value))}
                    style={{ width: '100%', height: 3, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                </div>
              </div>

              {/* Subsection: Detail Refinement */}
              <div style={{ border: '1px solid rgba(255,255,255,0.02)', borderRadius: 6, padding: '8px', background: 'rgba(255,255,255,0.01)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.04em' }}>Refinement</div>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 10, color: '#6b6b8a' }}>
                  <input
                    type="checkbox"
                    checked={finesse.smartRefine}
                    onChange={(e) => handleFinesseChange("smartRefine", e.target.checked)}
                    style={{ width: 12, height: 12, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  Smart Refine (improve hair edges)
                </label>
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* ── Bottom Timeline Scrubber and Tracking controls ── */}
      <div style={{
        height: 84, borderTop: '1px solid rgba(108, 99, 255, 0.1)', background: 'rgba(15, 15, 22, 0.95)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 20px', zIndex: 10
      }}>
        {/* Timeline Scrubber */}
        <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          
          {/* Keyframe Correction markers absolute overlay */}
          <div style={{ position: 'absolute', top: 5, left: 0, right: 0, height: 10, pointerEvents: 'none' }}>
            {keyframes.map(fIdx => {
              const pct = (fIdx / (totalFrames - 1)) * 100
              return (
                <div
                  key={`marker-${fIdx}`}
                  style={{
                    position: 'absolute', left: `${pct}%`, top: 0, width: 6, height: 8,
                    background: '#ffd700', borderRadius: '50%', transform: 'translateX(-50%)',
                    border: '1px solid #000', boxShadow: '0 0 4px rgba(255,215,0,0.5)',
                  }}
                  title={`Correction Keyframe ${fIdx + 1}`}
                />
              )
            })}
          </div>

          <input
            type="range"
            min="0"
            max={totalFrames - 1}
            value={currentFrame}
            onChange={(e) => {
              setAutoFollow(false)
              setCurrentFrame(parseInt(e.target.value))
            }}
            className="timeline-scrubber"
            style={{
              width: '100%', height: 4, cursor: 'pointer', zIndex: 3,
              outline: 'none', borderRadius: 2,
              background: `linear-gradient(to right, #8b5cf6 0%, #6c63ff ${(currentFrame / (totalFrames - 1)) * 100}%, rgba(255,255,255,0.06) ${(currentFrame / (totalFrames - 1)) * 100}%, rgba(255,255,255,0.06) 100%)`
            }}
          />
        </div>

        {/* Tracking Control Buttons row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          
          {/* Back direction tracking controls */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => handleTrack("backward")}
              disabled={tracking || (currentPoints.length === 0 && !currentBox && currentStrokes.length === 0)}
              style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6,
                padding: '6px 12px', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.15s'
              }}
              onMouseEnter={(e) => { if (!e.target.disabled) e.target.style.background = 'rgba(255,255,255,0.07)' }}
              onMouseLeave={(e) => { e.target.style.background = 'rgba(255,255,255,0.03)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 19 2 12 11 5 11 19"/><polygon points="22 19 13 12 22 5 22 19"/></svg>
              Track Backward
            </button>
            <button
              onClick={() => stepFrame(-1)}
              style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6,
                padding: '6px 12px', color: '#6b6b8a', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="4" x2="5" y2="20"/></svg>
              Step Back
            </button>
          </div>

          {/* Current Frame Counter */}
          <div style={{ fontSize: 12, color: '#a78bfa', fontFamily: 'monospace', fontWeight: 'bold' }}>
            Frame: {currentFrame + 1} / {totalFrames}
          </div>

          {/* Forward direction tracking controls */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => stepFrame(1)}
              style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6,
                padding: '6px 12px', color: '#6b6b8a', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
              }}
            >
              Step Fwd
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="4" x2="19" y2="20"/></svg>
            </button>
            <button
              onClick={() => handleTrack("forward")}
              disabled={tracking || (currentPoints.length === 0 && !currentBox && currentStrokes.length === 0)}
              style={{
                background: 'linear-gradient(135deg, #8b5cf6, #6c63ff)', border: 'none', borderRadius: 6,
                padding: '6px 16px', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                boxShadow: '0 2px 8px rgba(108, 99, 255, 0.3)', transition: 'all 0.15s'
              }}
              onMouseEnter={(e) => { if (!e.target.disabled) e.target.style.transform = 'translateY(-1px)' }}
              onMouseLeave={(e) => { e.target.style.transform = 'none' }}
            >
              Track Forward
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/></svg>
            </button>
          </div>

        </div>
      </div>

    </div>
  )
}
