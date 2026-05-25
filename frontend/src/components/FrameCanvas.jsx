import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react'

/**
 * FrameCanvas — displays a video frame with DaVinci-style overlay and drawing tools.
 *
 * Props:
 *   frameB64       — base64 JPEG frame
 *   overlayB64     — base64 RGBA PNG overlay (nullable)
 *   points         — [{ x, y, label }] in original image coords
 *   onAddPoint     — (x, y, label) => void
 *   originalW      — original image width
 *   originalH      — original image height
 *   drawingBox     — bool: drag draws a bounding box
 *   onBox          — ([x1,y1,x2,y2]) => void
 *   fillContainer  — bool: stretch canvas to fill parent
 *   activeToolMode — "add" | "subtract" | "paintAdd" | "paintSubtract"
 *   brushSize      — number (size in original resolution pixels)
 *   onBrushSizeChange — (newSize) => void (callback for scrollwheel change)
 *   onAddStroke    — (strokeObj) => void
 */
const FrameCanvas = forwardRef(function FrameCanvas(
  { frameB64, overlayB64, points = [], onAddPoint, originalW, originalH,
    drawingBox = false, onBox, fillContainer = false,
    activeToolMode = 'add', brushSize = 15, onBrushSizeChange, onAddStroke },
  ref
) {
  const canvasRef    = useRef(null)
  const containerRef = useRef(null)
  const imgRef       = useRef(null)          // original frame image element
  const overlayImgRef = useRef(null)         // overlay RGBA image element
  
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  const [dragStart, setDragStart]   = useState(null)
  const [dragEnd, setDragEnd]       = useState(null)

  // Paint state
  const [isPainting, setIsPainting] = useState(false)
  const [currentStroke, setCurrentStroke] = useState([]) // Canvas-space [{x, y}]
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [mouseOver, setMouseOver] = useState(false)

  // ── Load frame image ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!frameB64) return
    const img = new Image()
    img.onload = () => { imgRef.current = img; computeSize() }
    img.src = `data:image/jpeg;base64,${frameB64}`
  }, [frameB64])

  // ── Load overlay image ─────────────────────────────────
  useEffect(() => {
    if (!overlayB64) { overlayImgRef.current = null; draw(); return }
    const img = new Image()
    img.onload = () => { overlayImgRef.current = img; draw() }
    img.src = `data:image/png;base64,${overlayB64}`
  }, [overlayB64])

  // ── Compute canvas size to fit container (letterbox) ──────────────────────
  const computeSize = useCallback(() => {
    const el = containerRef.current
    if (!el || !imgRef.current) return
    const ratio = imgRef.current.naturalWidth / imgRef.current.naturalHeight
    let w, h
    if (fillContainer) {
      w = el.clientWidth
      h = el.clientHeight
      if (w / h > ratio) { w = Math.floor(h * ratio) }
      else               { h = Math.floor(w / ratio) }
    } else {
      const maxW = el.clientWidth
      const maxH = window.innerHeight * 0.65
      w = maxW; h = w / ratio
      if (h > maxH) { h = maxH; w = h * ratio }
    }
    setCanvasSize({ w: Math.floor(w), h: Math.floor(h) })
  }, [fillContainer])

  useEffect(() => {
    const observer = new ResizeObserver(computeSize)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [computeSize])

  // ── Main draw function ─────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || canvasSize.w === 0 || !imgRef.current) return
    canvas.width  = canvasSize.w
    canvas.height = canvasSize.h
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h)

    // 1. Draw original frame
    ctx.drawImage(imgRef.current, 0, 0, canvasSize.w, canvasSize.h)

    // 2. Draw mask/rubylith overlay
    if (overlayImgRef.current) {
      ctx.drawImage(overlayImgRef.current, 0, 0, canvasSize.w, canvasSize.h)
    }

    // 3. Draw click-point dots
    const natW = originalW || imgRef.current.naturalWidth
    const natH = originalH || imgRef.current.naturalHeight
    const sx = canvasSize.w / natW
    const sy = canvasSize.h / natH

    points.forEach(({ x, y, label }) => {
      const cx = x * sx
      const cy = y * sy
      const isFg = label === 1

      // Outer glow ring
      ctx.beginPath()
      ctx.arc(cx, cy, 9, 0, Math.PI * 2)
      ctx.fillStyle = isFg ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'
      ctx.fill()

      // Solid dot
      ctx.beginPath()
      ctx.arc(cx, cy, 6, 0, Math.PI * 2)
      ctx.fillStyle = isFg ? '#22c55e' : '#ef4444'
      ctx.fill()

      // White border
      ctx.beginPath()
      ctx.arc(cx, cy, 6, 0, Math.PI * 2)
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Plus/minus symbol
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 9px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(isFg ? '+' : '−', cx, cy)
    })

    // 4. Draw drag-box preview
    if (drawingBox && dragStart && dragEnd) {
      const x1 = Math.min(dragStart.x, dragEnd.x)
      const y1 = Math.min(dragStart.y, dragEnd.y)
      const bw = Math.abs(dragEnd.x - dragStart.x)
      const bh = Math.abs(dragEnd.y - dragStart.y)
      ctx.strokeStyle = '#ffd700'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(x1, y1, bw, bh)
      ctx.fillStyle = 'rgba(255,215,0,0.06)'
      ctx.fillRect(x1, y1, bw, bh)
      ctx.setLineDash([])
    }

    // 5. Draw active paint stroke in real-time
    const isPaintMode = activeToolMode === 'paintAdd' || activeToolMode === 'paintSubtract'
    if (isPaintMode && currentStroke.length > 0) {
      ctx.beginPath()
      ctx.moveTo(currentStroke[0].x, currentStroke[0].y)
      for (let i = 1; i < currentStroke.length; i++) {
        ctx.lineTo(currentStroke[i].x, currentStroke[i].y)
      }
      ctx.strokeStyle = activeToolMode === 'paintAdd' ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'
      ctx.lineWidth = brushSize * sx * 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    }

    // 6. Draw circular paint brush cursor outline
    if (isPaintMode && mouseOver && !drawingBox) {
      const brushRadius = brushSize * sx
      ctx.beginPath()
      ctx.arc(mousePos.x, mousePos.y, brushRadius, 0, Math.PI * 2)
      ctx.strokeStyle = activeToolMode === 'paintAdd' ? '#22c55e' : '#ef4444'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Small center dot
      ctx.beginPath()
      ctx.arc(mousePos.x, mousePos.y, 2, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
    }

  }, [canvasSize, points, originalW, originalH, drawingBox, dragStart, dragEnd, activeToolMode, currentStroke, brushSize, mousePos, mouseOver])

  useEffect(() => { draw() }, [draw])

  // ── Coordinate helpers ─────────────────────────────────────────────────────
  const toOriginalCoords = useCallback((clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const natW = originalW || imgRef.current?.naturalWidth || 1
    const natH = originalH || imgRef.current?.naturalHeight || 1
    return {
      x: Math.round((clientX - rect.left)  * (natW / rect.width)),
      y: Math.round((clientY - rect.top)   * (natH / rect.height)),
    }
  }, [originalW, originalH])

  const toCanvasCoords = useCallback((clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }, [])

  // ── Scrollwheel Brush Resize ───────────────────────────────────────────────
  const handleWheel = useCallback((e) => {
    const isPaintMode = activeToolMode === 'paintAdd' || activeToolMode === 'paintSubtract'
    if (!isPaintMode || !onBrushSizeChange) return
    e.preventDefault()
    // Scroll up (deltaY < 0) -> increase brush size, down -> decrease
    const step = 2
    const dir = e.deltaY < 0 ? 1 : -1
    const nextSize = Math.max(2, Math.min(100, brushSize + dir * step))
    onBrushSizeChange(nextSize)
  }, [activeToolMode, brushSize, onBrushSizeChange])

  // ── Mouse Events ───────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e) => {
    const isPaintMode = activeToolMode === 'paintAdd' || activeToolMode === 'paintSubtract'
    if (drawingBox) {
      setDragStart(toCanvasCoords(e.clientX, e.clientY))
      setDragEnd(null)
    } else if (isPaintMode) {
      setIsPainting(true)
      const coords = toCanvasCoords(e.clientX, e.clientY)
      setCurrentStroke([coords])
    }
  }, [drawingBox, activeToolMode, toCanvasCoords])

  const handleMouseMove = useCallback((e) => {
    const coords = toCanvasCoords(e.clientX, e.clientY)
    setMousePos(coords)
    setMouseOver(true)

    if (drawingBox && dragStart) {
      setDragEnd(coords)
    } else if (isPainting) {
      setCurrentStroke(prev => [...prev, coords])
    }
  }, [drawingBox, dragStart, isPainting, toCanvasCoords])

  const handleMouseUp = useCallback((e) => {
    if (drawingBox && dragStart) {
      const end = toCanvasCoords(e.clientX, e.clientY)
      const natW = originalW || imgRef.current?.naturalWidth || 1
      const natH = originalH || imgRef.current?.naturalHeight || 1
      const rect = canvasRef.current.getBoundingClientRect()
      const sx = natW / rect.width
      const sy = natH / rect.height
      const box = [
        Math.round(Math.min(dragStart.x, end.x) * sx),
        Math.round(Math.min(dragStart.y, end.y) * sy),
        Math.round(Math.max(dragStart.x, end.x) * sx),
        Math.round(Math.max(dragStart.y, end.y) * sy),
      ]
      onBox?.(box)
      setDragStart(null); setDragEnd(null)
    } else if (isPainting) {
      setIsPainting(false)
      if (currentStroke.length > 0 && onAddStroke) {
        // Map all canvas points to original image coordinate space
        const natW = originalW || imgRef.current?.naturalWidth || 1
        const natH = originalH || imgRef.current?.naturalHeight || 1
        const rect = canvasRef.current.getBoundingClientRect()
        const sx = natW / rect.width
        const sy = natH / rect.height

        const mappedPoints = currentStroke.map(p => [
          Math.round(p.x * sx),
          Math.round(p.y * sy)
        ])

        const isAdd = activeToolMode === 'paintAdd'
        onAddStroke({
          points: mappedPoints,
          radius: brushSize,
          label: isAdd ? 1 : 0
        })
      }
      setCurrentStroke([])
    }
  }, [drawingBox, dragStart, isPainting, currentStroke, onAddStroke, originalW, originalH, activeToolMode, brushSize, toCanvasCoords])

  const handleClick = useCallback((e) => {
    const isClickMode = activeToolMode === 'add' || activeToolMode === 'subtract'
    if (drawingBox || !isClickMode) return
    e.preventDefault()
    const { x, y } = toOriginalCoords(e.clientX, e.clientY)
    const label = activeToolMode === 'add' ? 1 : 0
    onAddPoint?.(x, y, label)
  }, [drawingBox, activeToolMode, toOriginalCoords, onAddPoint])

  const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    const { x, y } = toOriginalCoords(e.clientX, e.clientY)
    // Right click always acts as a subtract point in click modes
    const isClickMode = activeToolMode === 'add' || activeToolMode === 'subtract'
    if (isClickMode) {
      onAddPoint?.(x, y, 0)
    }
  }, [activeToolMode, toOriginalCoords, onAddPoint])

  useImperativeHandle(ref, () => ({ clear: () => { overlayImgRef.current = null; draw() } }))

  // Hide browser cursor only when painting/hovering over canvas
  const isPaintMode = activeToolMode === 'paintAdd' || activeToolMode === 'paintSubtract'
  const canvasCursor = drawingBox ? 'crosshair' : (isPaintMode ? 'none' : 'crosshair')

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%', height: fillContainer ? '100%' : 'auto',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#000', position: 'relative',
      }}
    >
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        style={{
          display: 'block',
          cursor: canvasCursor,
          maxWidth: '100%',
          maxHeight: '100%',
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onMouseEnter={() => setMouseOver(true)}
        onMouseLeave={() => { setMouseOver(false); setIsPainting(false); setCurrentStroke([]) }}
        id="frame-canvas"
      />

      {/* Mode hint badge */}
      {drawingBox && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,215,0,0.3)', borderRadius: 99,
          padding: '4px 14px', color: 'rgba(255,215,0,0.9)', fontSize: 12,
          pointerEvents: 'none',
        }}>
          Drag to draw bounding box
        </div>
      )}
      {isPaintMode && mouseOver && (
        <div style={{
          position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          borderRadius: 8, padding: '4px 12px', color: 'rgba(255,255,255,0.7)', fontSize: 11,
          pointerEvents: 'none', display: 'flex', gap: 12
        }}>
          <span>Brush Size: {brushSize}px</span>
          <span style={{ opacity: 0.5 }}>•</span>
          <span>Scrollwheel or [ ] to resize</span>
        </div>
      )}
    </div>
  )
})

export default FrameCanvas
