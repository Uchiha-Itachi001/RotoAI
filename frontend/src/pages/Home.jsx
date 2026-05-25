import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import VideoUploader from '../components/VideoUploader'
import Navbar from '../components/Navbar'
import { api } from '../api/client'
import { useSession } from '../hooks/useSession'

const FEATURES = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="6"/>
        <circle cx="12" cy="12" r="2"/>
      </svg>
    ),
    title: 'Click to Mask',
    desc: 'Click on any subject — SAM 2 instantly generates a perfect mask.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
    ),
    title: 'Full Video Propagation',
    desc: 'AI tracks the subject across every frame automatically.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
        <line x1="7" y1="2" x2="7" y2="22"/>
        <line x1="17" y1="2" x2="17" y2="22"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
      </svg>
    ),
    title: 'Pro Exports',
    desc: 'B&W Matte, Alpha Channel, or Greenscreen — all in one click.',
  },
]

export default function Home() {
  const navigate = useNavigate()
  const { setSession, saveRecent, recentSessions } = useSession()
  const [file, setFile] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [duration, setDuration] = useState(0)
  const [videoWidth, setVideoWidth] = useState(0)
  const [videoHeight, setVideoHeight] = useState(0)
  const [startTime, setStartTime] = useState(0)
  const [endTime, setEndTime] = useState(0)
  const [targetFps, setTargetFps] = useState(-1) // -1 means original
  const [rangeMode, setRangeMode] = useState('all') // all | custom
  const [uploading, setUploading] = useState(false)
  const [extractProgress, setExtractProgress] = useState({ status: 'initializing', frame: 0, total: 100 })
  const [error, setError] = useState(null)

  const videoRef = useRef(null)

  const handleFileSelect = useCallback((selectedFile, validationError) => {
    if (validationError) {
      setError(validationError)
      return
    }
    if (!selectedFile) return

    setError(null)
    setFile(selectedFile)
    const url = URL.createObjectURL(selectedFile)
    setVideoUrl(url)

    // Retrieve video details
    const tempVideo = document.createElement('video')
    tempVideo.preload = 'metadata'
    tempVideo.src = url
    tempVideo.onloadedmetadata = () => {
      setDuration(tempVideo.duration)
      setEndTime(tempVideo.duration)
      setVideoWidth(tempVideo.videoWidth)
      setVideoHeight(tempVideo.videoHeight)
      window.URL.revokeObjectURL(tempVideo.src)
    }
  }, [])

  const handleReset = useCallback(() => {
    setFile(null)
    setVideoUrl(null)
    setDuration(0)
    setStartTime(0)
    setEndTime(0)
    setVideoWidth(0)
    setVideoHeight(0)
    setTargetFps(-1)
    setRangeMode('all')
    setError(null)
  }, [])

  const handleUpload = useCallback(async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    setExtractProgress({ status: 'initializing', frame: 0, total: 100 })

    const sessionId = crypto.randomUUID()

    // Start progress polling
    const pollInterval = setInterval(async () => {
      try {
        const prog = await api.getUploadProgress(sessionId)
        if (prog) {
          setExtractProgress(prog)
        }
      } catch (e) {
        // ignore polling errors temporarily
      }
    }, 400);

    try {
      const finalStartTime = rangeMode === 'custom' ? parseFloat(startTime) : 0.0
      const finalEndTime = rangeMode === 'custom' ? parseFloat(endTime) : -1.0

      const data = await api.upload(file, finalStartTime, finalEndTime, targetFps, sessionId)
      clearInterval(pollInterval)

      setSession({
        id: data.session_id,
        firstFrameB64: data.first_frame_b64,
        totalFrames: data.total_frames,
        fps: data.fps,
        width: data.width,
        height: data.height,
      })
      saveRecent(data.session_id, file.name)
      navigate(`/canvas/${data.session_id}`, {
        state: {
          session: {
            id: data.session_id,
            firstFrameB64: data.first_frame_b64,
            totalFrames: data.total_frames,
            fps: data.fps,
            width: data.width,
            height: data.height,
            original_filename: file.name
          }
        }
      })
    } catch (err) {
      clearInterval(pollInterval)
      setError(err.message || 'Upload failed. Is the backend running?')
    } finally {
      setUploading(false)
    }
  }, [file, rangeMode, startTime, endTime, targetFps, setSession, saveRecent, navigate])

  const formatTime = (ts) => {
    const d = new Date(ts)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const formatSeconds = (sec) => {
    if (isNaN(sec)) return '0:00'
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  return (
    <div style={{ position: 'relative', overflowX: 'hidden', minHeight: '100vh', background: '#070709', display: 'flex', flexDirection: 'column' }}>
      
      {/* Navbar */}
      <Navbar />

      {/* Background ambient glow */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: `
          radial-gradient(ellipse 60% 40% at 20% 20%, rgba(108,99,255,0.06) 0%, transparent 60%),
          radial-gradient(ellipse 50% 50% at 80% 80%, rgba(192,132,252,0.04) 0%, transparent 60%)
        `,
      }} />

      <div className="page-container" style={{ position: 'relative', zIndex: 1, paddingTop: 100, paddingBottom: 80, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>

        {/* Hero Section (only when no file selected) */}
        {!file && (
          <div style={{ textAlign: 'center', marginBottom: 44, animation: 'fadeIn 0.5s ease both' }}>
            <div style={{ marginBottom: 16 }}>
              <span className="badge badge-accent" style={{ display: 'inline-flex', padding: '4px 12px' }}>
                <span className="glow-dot" style={{ width: 6, height: 6 }} />
                Intel Iris Xe Graphics Optimized
              </span>
            </div>

            <h1 style={{ marginBottom: 16 }}>
              AI Masking.{' '}
              <span className="text-gradient">No Studio Required.</span>
            </h1>

            <p style={{
              fontSize: 16, color: 'var(--text-muted)', maxWidth: 520, margin: '0 auto',
              lineHeight: 1.6,
            }}>
              Import a video clip, specify target frames, and track subjects with Meta SAM 2.
              Configure range and FPS to optimize speed locally on integrated GPUs.
            </p>
          </div>
        )}

        {/* main workspace box */}
        <div style={{ maxWidth: file ? 960 : 680, width: '100%', margin: '0 auto', animation: 'fadeIn 0.5s ease both' }}>
          
          {!file ? (
            // Dropzone view
            <VideoUploader
              onFile={handleFileSelect}
              uploading={uploading}
              error={error}
            />
          ) : (
            // Configurator view
            <div className="card" style={{ background: 'rgba(17, 17, 24, 0.75)', backdropFilter: 'blur(20px)', border: '1px solid rgba(108, 99, 255, 0.12)', borderRadius: 16, padding: '24px' }}>
              
              {uploading ? (
                // Uploading and frame extraction loading state
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 24, padding: 20 }}>
                  <div style={{ position: 'relative', width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg className="animate-spin" width="64" height="64" viewBox="0 0 64 64" fill="none">
                      <circle cx="32" cy="32" r="28" stroke="rgba(255,255,255,0.05)" strokeWidth="3"/>
                      <path d="M32 4 A28 28 0 0 1 60 32" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"/>
                    </svg>
                    {extractProgress.status === 'extracting' && (
                      <span style={{ position: 'absolute', fontSize: 11, fontWeight: 'bold', fontFamily: 'monospace', color: '#a78bfa' }}>
                        {Math.round((extractProgress.frame / extractProgress.total) * 100)}%
                      </span>
                    )}
                  </div>
                  <div style={{ textAlign: 'center', width: '100%', maxWidth: 360 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                      {extractProgress.status === 'extracting'
                        ? 'Extracting & Loading Frames'
                        : 'Uploading Video File...'}
                    </h3>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                      {extractProgress.status === 'extracting'
                        ? `Extracting frame ${extractProgress.frame} of ${extractProgress.total} from source...`
                        : 'Preparing session workspace on your local machine...'}
                    </p>
                    
                    {/* Progress Bar Track */}
                    <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        background: 'linear-gradient(90deg, #8b5cf6, #6c63ff)',
                        borderRadius: 3,
                        transition: 'width 0.2s ease-out',
                        width: extractProgress.status === 'extracting'
                          ? `${(extractProgress.frame / extractProgress.total) * 100}%`
                          : '10%'
                      }} />
                    </div>
                  </div>
                </div>
              ) : (
                // Settings editor split pane
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, alignItems: 'start' }}>
                  
                  {/* Left Column: Local Video Preview */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Clip Source Preview
                    </div>
                    
                    <div style={{ background: '#000', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', position: 'relative' }}>
                      <video
                        ref={videoRef}
                        src={videoUrl}
                        controls
                        style={{ width: '100%', display: 'block', maxHeight: 260, objectFit: 'contain' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: 8, padding: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>File Name</span>
                        <span style={{ color: '#f0f0ff', fontWeight: 500, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>{file.name}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Resolution</span>
                        <span style={{ color: '#f0f0ff', fontWeight: 500 }}>{videoWidth} × {videoHeight}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Duration</span>
                        <span style={{ color: '#f0f0ff', fontWeight: 500 }}>{formatSeconds(duration)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)' }}>File Size</span>
                        <span style={{ color: '#f0f0ff', fontWeight: 500 }}>{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Configure Settings */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Session Configuration
                    </div>

                    {/* Frame Range Options */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#c4c4e0', display: 'block', marginBottom: 8 }}>
                        Frame Range Mode
                      </label>
                      <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 2 }}>
                        {[
                          { mode: 'all', label: 'All Frames' },
                          { mode: 'custom', label: 'Custom Clip Range' }
                        ].map(m => (
                          <button
                            key={m.mode}
                            onClick={() => setRangeMode(m.mode)}
                            style={{
                              flex: 1, padding: '6px 0', border: 'none', borderRadius: 6, cursor: 'pointer',
                              fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
                              background: rangeMode === m.mode ? 'var(--accent)' : 'transparent',
                              color: rangeMode === m.mode ? '#fff' : '#6b6b8a',
                            }}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>

                      {rangeMode === 'custom' && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, animation: 'fadeInFast 0.2s ease' }}>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: 10, color: '#6b6b8a', display: 'block', marginBottom: 2 }}>Start Time (s)</span>
                            <input
                              type="number"
                              min="0"
                              max={endTime}
                              step="0.1"
                              value={startTime}
                              onChange={(e) => setStartTime(Math.max(0, Math.min(parseFloat(e.target.value) || 0, endTime)))}
                              className="input"
                              style={{ padding: '8px 10px', fontSize: 12, borderRadius: 6 }}
                            />
                          </div>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: 10, color: '#6b6b8a', display: 'block', marginBottom: 2 }}>End Time (s)</span>
                            <input
                              type="number"
                              min={startTime}
                              max={duration}
                              step="0.1"
                              value={endTime}
                              onChange={(e) => setEndTime(Math.min(duration, Math.max(parseFloat(e.target.value) || 0, startTime)))}
                              className="input"
                              style={{ padding: '8px 10px', fontSize: 12, borderRadius: 6 }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Target FPS Speed Optimization */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#c4c4e0', display: 'block', marginBottom: 6 }}>
                        Frame Rate Resampling (Optimization)
                      </label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {[
                          { val: -1, label: 'Original' },
                          { val: 24, label: '24 FPS' },
                          { val: 15, label: '15 FPS' },
                          { val: 12, label: '12 FPS' }
                        ].map(f => (
                          <button
                            key={f.val}
                            onClick={() => setTargetFps(f.val)}
                            style={{
                              flex: '1 0 60px', padding: '6px 0', border: '1px solid ' + (targetFps === f.val ? 'var(--accent)' : 'rgba(255,255,255,0.05)'),
                              borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
                              background: targetFps === f.val ? 'rgba(108,99,255,0.15)' : 'rgba(255,255,255,0.02)',
                              color: targetFps === f.val ? '#a78bfa' : '#6b6b8a',
                            }}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 8, alignItems: 'flex-start' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(108,99,255,0.6)" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                        <span style={{ fontSize: 10, color: '#6b6b8a', lineHeight: 1.4 }}>
                          {targetFps > 0 && targetFps <= 15
                            ? 'Selected resampled FPS. Ideal for Intel Iris Xe integrated graphics, cuts tracking times in half.'
                            : 'Standard FPS range. If tracking feels sluggish on integrated GPUs, try 15 FPS.'}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                      <button
                        onClick={handleUpload}
                        className="btn btn-primary"
                        style={{ width: '100%', padding: '12px 0', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                      >
                        Initialize Magic Mask Session
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>

                      <button
                        onClick={handleReset}
                        style={{
                          width: '100%', padding: '10px 0', borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.08)',
                          background: 'rgba(255,255,255,0.02)', color: '#8b8baf', fontSize: 12, fontWeight: 600, transition: 'all 0.15s'
                        }}
                        onMouseEnter={(e) => { e.target.style.background = 'rgba(255,255,255,0.06)'; e.target.style.color = '#fff' }}
                        onMouseLeave={(e) => { e.target.style.background = 'rgba(255,255,255,0.02)'; e.target.style.color = '#8b8baf' }}
                      >
                        Change Video Source
                      </button>
                    </div>

                  </div>

                </div>
              )}

              {/* Configure error */}
              {error && (
                <div style={{
                  marginTop: 16, background: 'var(--error-glow)', border: '1px solid var(--error)',
                  borderRadius: 8, padding: '10px 16px', color: 'var(--error)', fontSize: 12,
                  display: 'flex', gap: 8, alignItems: 'center'
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {error}
                </div>
              )}

            </div>
          )}

          {/* Backend status connection hint */}
          {!file && (
            <p style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, marginTop: 12 }}>
              Backend connection:{' '}
              <code style={{ color: 'var(--accent-light)', background: 'rgba(255,255,255,0.02)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>
                http://localhost:8000
              </code>
            </p>
          )}
        </div>

        {/* Feature list section (only when no file selected) */}
        {!file && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16, maxWidth: 800, margin: '44px auto 0',
            animation: 'fadeIn 0.5s ease both'
          }}>
            {FEATURES.map(f => (
              <div key={f.title} className="card" style={{ background: 'rgba(15, 15, 22, 0.5)', border: '1px solid rgba(255,255,255,0.03)', textAlign: 'center', padding: '24px 20px', borderRadius: 12 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{f.icon}</div>
                <h4 style={{ marginBottom: 6, fontSize: 13, fontFamily: 'var(--font-display)', color: '#fff' }}>{f.title}</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        )}

        {/* Recent sessions grid */}
        {!file && recentSessions.length > 0 && (
          <div style={{ maxWidth: 680, width: '100%', margin: '40px auto 0', animation: 'fadeIn 0.5s ease both' }}>
            <div className="divider" style={{ opacity: 0.5, margin: '20px 0' }} />
            <h3 style={{ marginBottom: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Recent Workspace Sessions
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
              {recentSessions.slice(0, 5).map(s => (
                <div
                  key={s.id}
                  className="card"
                  style={{
                    padding: '10px 14px', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', gap: 12, cursor: 'pointer',
                    borderRadius: 10, background: 'rgba(17,17,24,0.4)',
                    borderColor: 'rgba(255,255,255,0.03)',
                    transition: 'all 0.15s'
                  }}
                  onClick={() => navigate(`/canvas/${s.id}`)}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(108,99,255,0.3)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.03)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: 'rgba(108,99,255,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--accent-light)', flexShrink: 0,
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="2" width="20" height="20" rx="2" ry="2"/>
                        <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: '#f0f0ff', fontWeight: 500 }}>
                        {s.filename || s.id.slice(0, 8) + '…'}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                        {formatTime(s.timestamp)}
                      </div>
                    </div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
