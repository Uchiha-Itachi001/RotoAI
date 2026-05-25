import { useEffect, useState, useRef } from 'react'
import { api, getApiUrl } from '../api/client'

export default function BackendStatus() {
  const [status, setStatus] = useState('checking')
  const [info, setInfo] = useState(null)
  const [showPopover, setShowPopover] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    // Fetch server status on mount
    api.health()
      .then(data => {
        setStatus('online')
        setInfo(data)
      })
      .catch(() => {
        setStatus('offline')
      })
  }, [])

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowPopover(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Icons
  const ChipIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 2 }}>
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="15" x2="23" y2="15" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="15" x2="4" y2="15" />
    </svg>
  )

  const WarningIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 2 }}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )

  const PlugIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )

  const isGpu = info?.gpu && info.gpu !== 'none'

  let pillStyle = {}
  let dotColor = ''
  let pillText = ''
  let pillIcon = null

  if (status === 'checking') {
    pillStyle = {
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
      color: '#6b6b8a'
    }
    dotColor = '#6b6b8a'
    pillText = 'Connecting...'
  } else if (status === 'offline') {
    pillStyle = {
      background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)',
      color: '#ef4444'
    }
    dotColor = '#ef4444'
    pillText = 'Backend Offline'
  } else if (isGpu) {
    pillStyle = {
      background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.25)',
      color: '#22c55e', boxShadow: '0 0 10px rgba(34,197,94,0.1)'
    }
    dotColor = '#22c55e'
    pillText = `GPU Active · ${info.gpu}`
    pillIcon = <ChipIcon />
  } else {
    pillStyle = {
      background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)',
      color: '#f59e0b'
    }
    dotColor = '#f59e0b'
    pillText = 'Local CPU · (Slow)'
    pillIcon = <WarningIcon />
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Interactive pill */}
      <button
        onClick={() => setShowPopover(!showPopover)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 12px', borderRadius: 20,
          fontSize: 11, fontWeight: 600,
          cursor: 'pointer', outline: 'none', transition: 'all 0.2s',
          fontFamily: 'inherit',
          ...pillStyle
        }}
        onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.15)' }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
        title="Click to view backend connection details"
      >
        <span className="glow-dot" style={{
          width: 6, height: 6, borderRadius: '50%',
          background: dotColor,
          boxShadow: status === 'checking' ? 'none' : `0 0 6px ${dotColor}`,
          display: 'inline-block'
        }} />
        {pillIcon}
        <span>{pillText}</span>
      </button>

      {/* Popover settings panel */}
      {showPopover && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 260, padding: 16, borderRadius: 12,
          background: 'rgba(15, 15, 22, 0.95)', border: '1px solid rgba(108, 99, 255, 0.2)',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(16px)', zIndex: 1000,
          color: '#f0f0ff', textAlign: 'left',
          animation: 'fade-in 0.15s ease-out'
        }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, color: '#a78bfa' }}>
            <PlugIcon />
            <span>Local Backend Status</span>
          </h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11, color: '#c4c4e0' }}>
            <div>
              <span style={{ color: '#6b6b8a' }}>Status: </span>
              <span style={{ color: status === 'online' ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                {status === 'online' ? 'Online' : 'Offline'}
              </span>
            </div>
            {info && (
              <>
                <div>
                  <span style={{ color: '#6b6b8a' }}>Inference Device: </span>
                  <span style={{ fontFamily: 'monospace', color: '#8b84ff' }}>{info.device}</span>
                </div>
                <div>
                  <span style={{ color: '#6b6b8a' }}>GPU Acceleration: </span>
                  <span style={{ color: isGpu ? '#22c55e' : '#f59e0b' }}>
                    {isGpu ? info.gpu : 'None (CPU Fallback)'}
                  </span>
                </div>
              </>
            )}
            <div style={{ marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8, fontSize: 9, color: '#4b4b6a' }}>
              Host: <span style={{ fontFamily: 'monospace', color: '#8b84ff' }}>{getApiUrl() || 'http://localhost:8000'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
