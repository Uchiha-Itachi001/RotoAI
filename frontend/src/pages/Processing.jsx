import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ProgressBar from '../components/ProgressBar'
import { useWebSocket } from '../hooks/useWebSocket'
import { api } from '../api/client'

export default function Processing() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [progress, setProgress] = useState({ frame: 0, total: 0, status: 'processing' })
  const [error, setError] = useState(null)
  const startTimeRef = useRef(Date.now())

  const onMessage = useCallback((data) => {
    if (data.status === 'processing') {
      setProgress({ frame: data.frame, total: data.total, status: 'processing' })
    } else if (data.status === 'done') {
      setProgress(prev => ({ ...prev, status: 'done' }))
      setTimeout(() => navigate(`/export/${sessionId}`), 800)
    } else if (data.status === 'error') {
      setError(data.message || 'Processing failed.')
      setProgress(prev => ({ ...prev, status: 'error' }))
    }
  }, [sessionId, navigate])

  const { disconnect } = useWebSocket(sessionId, onMessage)

  const handleCancel = useCallback(async () => {
    disconnect()
    try { await api.deleteSession(sessionId) } catch {}
    navigate('/')
  }, [sessionId, disconnect, navigate])

  // ─── Derived values ────────────────────────────────────────────────────────
  const pct = progress.total > 0
    ? Math.round((progress.frame / progress.total) * 100)
    : 0

  const elapsed = (Date.now() - startTimeRef.current) / 1000
  const framesPerSec = progress.frame > 0 ? progress.frame / elapsed : 0
  const remaining = framesPerSec > 0 && progress.total > progress.frame
    ? Math.ceil((progress.total - progress.frame) / framesPerSec)
    : null

  const formatSecs = (s) => {
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24, position: 'relative', overflow: 'hidden',
    }}>
      {/* Animated background */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: `radial-gradient(ellipse 80% 60% at 50% 50%, rgba(108,99,255,0.06) 0%, transparent 70%)`,
      }} />

      {/* Pulsing rings */}
      {progress.status === 'processing' && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{
              position: 'absolute',
              width: 200 + i * 120, height: 200 + i * 120,
              borderRadius: '50%',
              border: '1px solid rgba(108,99,255,0.08)',
              animation: `pulse-glow ${1.5 + i * 0.5}s ease-in-out infinite`,
              animationDelay: `${i * 0.3}s`,
            }} />
          ))}
        </div>
      )}

      <div className="card animate-fade-in" style={{
        width: '100%', maxWidth: 560, position: 'relative', zIndex: 1,
        padding: 40,
      }}>
        {/* Status icon */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          {progress.status === 'error' ? (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
          ) : progress.status === 'done' ? (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, animation: 'fadeIn 0.4s ease' }}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
          ) : (
            <div style={{ position: 'relative', width: 72, height: 72, margin: '0 auto 16px' }}>
              {/* Outer rotating ring */}
              <svg
                className="animate-spin"
                width="72" height="72" viewBox="0 0 72 72" fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ position: 'absolute', top: 0, left: 0 }}
              >
                <circle cx="36" cy="36" r="32" stroke="var(--border)" strokeWidth="3"/>
                <path
                  d="M36 4 A32 32 0 0 1 68 36"
                  stroke="url(#pg)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="pg" x1="36" y1="4" x2="68" y2="36" gradientUnits="userSpaceOnUse">
                    <stop stopColor="var(--accent-light)"/>
                    <stop offset="1" stopColor="var(--accent)"/>
                  </linearGradient>
                </defs>
              </svg>
              {/* Center percentage */}
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--accent-light)',
              }}>
                {pct}%
              </div>
            </div>
          )}

          <h2 style={{ marginBottom: 8 }}>
            {progress.status === 'error' ? 'Processing Failed'
              : progress.status === 'done' ? 'Complete!'
              : 'Processing Video'}
          </h2>

          {progress.status === 'processing' && (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              SAM 2 is tracking your subject across all frames…
            </p>
          )}
        </div>

        {/* Error state */}
        {error && (
          <div style={{
            marginBottom: 24, padding: '14px 18px', borderRadius: 'var(--radius-md)',
            background: 'var(--error-glow)', border: '1px solid var(--error)',
            color: 'var(--error)', fontSize: 14, lineHeight: 1.6,
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Progress section */}
        {(progress.status === 'processing' || progress.status === 'done') && (
          <div style={{ marginBottom: 28 }}>
            <ProgressBar
              value={progress.status === 'done' ? 100 : pct}
              label={
                progress.status === 'done'
                  ? 'Done!'
                  : progress.total > 0
                    ? `Processing frame ${progress.frame} / ${progress.total}`
                    : 'Initializing SAM 2…'
              }
              sublabel={remaining !== null ? `~${formatSecs(remaining)} remaining` : ''}
            />
          </div>
        )}

        {/* Stats row */}
        {progress.total > 0 && progress.status === 'processing' && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
            marginBottom: 28,
          }}>
            {[
              { label: 'Frame', value: progress.frame },
              { label: 'Total', value: progress.total },
              { label: 'Speed', value: framesPerSec > 0 ? `${framesPerSec.toFixed(1)} fps` : '—' },
            ].map(s => (
              <div key={s.label} className="card-surface" style={{ textAlign: 'center', padding: '10px 8px' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--accent-light)', marginBottom: 2 }}>
                  {s.value}
                </div>
                <div style={{ color: 'var(--text-faint)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          {progress.status === 'error' ? (
            <>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => navigate(-1)} id="go-back-btn">
                ← Try Again
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate('/')} id="new-session-btn">
                New Session
              </button>
            </>
          ) : progress.status === 'done' ? (
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate(`/export/${sessionId}`)}>
              Go to Export →
            </button>
          ) : (
            <button
              className="btn btn-danger"
              style={{ flex: 1 }}
              onClick={handleCancel}
              id="cancel-processing-btn"
            >
              Cancel Processing
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
