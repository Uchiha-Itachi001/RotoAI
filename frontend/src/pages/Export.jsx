import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ExportPanel from '../components/ExportPanel'
import { api } from '../api/client'

export default function Export() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [exporting, setExporting] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState(null)
  const [exportMode, setExportMode] = useState(null)
  const [error, setError] = useState(null)
  const [pollInterval, setPollInterval] = useState(null)

  // Stop polling on unmount
  useEffect(() => () => { if (pollInterval) clearInterval(pollInterval) }, [pollInterval])

  // ─── Poll export status ─────────────────────────────────────────────────────
  const startPolling = useCallback((mode) => {
    const interval = setInterval(async () => {
      try {
        const status = await api.exportStatus(sessionId)
        if (status.status === 'done') {
          clearInterval(interval)
          setPollInterval(null)
          setExporting(false)
          setDownloadUrl(status.download_url || `/api/download/${sessionId}/${mode}`)
        } else if (status.status === 'error') {
          clearInterval(interval)
          setPollInterval(null)
          setExporting(false)
          setError(status.message || 'Export failed.')
        }
      } catch (e) {
        // keep polling on transient errors
      }
    }, 2000)
    setPollInterval(interval)
  }, [sessionId])

  const handleExport = useCallback(async (mode, quality) => {
    setError(null)
    setDownloadUrl(null)
    setExporting(true)
    setExportMode(mode)
    try {
      await api.exportVideo(sessionId, mode, quality)
      startPolling(mode)
    } catch (err) {
      setError(err.message)
      setExporting(false)
    }
  }, [sessionId, startPolling])

  const modeLabel = {
    bw_matte: 'B&W Matte',
    alpha: 'Alpha Channel',
    greenscreen: 'Greenscreen',
  }

  return (
    <div style={{ minHeight: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Background */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: `
          radial-gradient(ellipse 50% 60% at 10% 90%, rgba(34,197,94,0.04) 0%, transparent 60%),
          radial-gradient(ellipse 50% 60% at 90% 10%, rgba(108,99,255,0.06) 0%, transparent 60%)
        `,
      }} />

      <div className="page-container" style={{ position: 'relative', zIndex: 1, paddingTop: 40, paddingBottom: 60 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 36, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 8 }}>
              ← Back
            </button>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              Export Result
              {downloadUrl && (
                <span className="badge badge-success">
                  <span className="glow-dot" style={{ width: 6, height: 6, background: 'var(--success)', boxShadow: '0 0 6px var(--success)' }} />
                  Ready
                </span>
              )}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
              Session: <code style={{ color: 'var(--accent-light)', fontSize: 13 }}>{sessionId?.slice(0, 8)}…</code>
            </p>
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => navigate('/')}
            id="new-session-btn"
          >
            + New Session
          </button>
        </div>

        {/* Main content — two columns */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 24, alignItems: 'start' }}>

          {/* Left — preview panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{
                background: 'var(--bg-surface)', padding: '12px 20px',
                borderBottom: '1px solid var(--border)',
                fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2">
                  <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                Output Preview
              </div>

              {/* Preview video */}
              <div style={{
                background: '#000', minHeight: 280,
                display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
              }}>
                {downloadUrl ? (
                  <video
                    src={downloadUrl}
                    controls
                    loop
                    autoPlay
                    muted
                    style={{ maxWidth: '100%', maxHeight: 400, display: 'block' }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 40 }}>
                    {exporting ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <svg className="animate-spin" width="40" height="40" viewBox="0 0 40 40" fill="none">
                          <circle cx="20" cy="20" r="17" stroke="var(--border)" strokeWidth="3"/>
                          <path d="M20 3 A17 17 0 0 1 37 20" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"/>
                        </svg>
                        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                          Rendering {modeLabel[exportMode]}…
                        </span>
                      </div>
                    ) : (
                      <div>
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 12px' }}>
                          <rect x="2" y="2" width="20" height="20" rx="2" ry="2"/>
                          <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>
                        </svg>
                        <p style={{ fontSize: 14 }}>
                          Select format and click Export<br/>to render your masked video.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Download success banner */}
            {downloadUrl && (
              <div className="card animate-fade-in" style={{
                background: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.3)',
                padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--success)', marginBottom: 2 }}>
                    Export Complete!
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Your {modeLabel[exportMode]} is ready to download.
                  </div>
                </div>
              </div>
            )}

            {/* Info cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto' }}>
                      <circle cx="12" cy="12" r="10"/>
                      <circle cx="12" cy="12" r="6"/>
                      <circle cx="12" cy="12" r="2"/>
                    </svg>
                  ),
                  label: 'AI Masking',
                  desc: 'SAM 2 tracked every frame'
                },
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto' }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  ),
                  label: '100% Local',
                  desc: 'Your video never leaves your machine'
                },
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto' }}>
                      <rect x="2" y="2" width="20" height="20" rx="2" ry="2"/>
                      <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>
                    </svg>
                  ),
                  label: 'NLE Ready',
                  desc: 'Drop directly into Premiere, DaVinci, etc.'
                }
              ].map(c => (
                <div key={c.label} className="card-surface" style={{ textAlign: 'center', padding: '16px 12px' }}>
                  <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'center' }}>{c.icon}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{c.label}</div>
                  <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>{c.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — export panel */}
          <div className="card" style={{ position: 'sticky', top: 88 }}>
            <ExportPanel
              onExport={handleExport}
              exporting={exporting}
              downloadUrl={downloadUrl}
              error={error}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
