import { useRef, useState, useCallback } from 'react'

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const ACCEPTED_EXTS = ['.mp4', '.mov', '.webm']
const MAX_SIZE_MB = 500

/**
 * VideoUploader — drag-and-drop / click-to-select video upload zone.
 *
 * Props:
 *   onFile(file)  — called when a valid file is selected
 *   uploading     — show spinner
 *   error         — error message string
 */
export default function VideoUploader({ onFile, uploading = false, error = null }) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)

  const validate = useCallback((file) => {
    const ext = file.name.toLowerCase().split('.').pop()
    const typeOk = ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTS.includes(`.${ext}`)
    if (!typeOk) return `Unsupported format. Please use MP4, MOV, or WebM.`
    const sizeMB = file.size / (1024 * 1024)
    if (sizeMB > MAX_SIZE_MB) return `File too large (${sizeMB.toFixed(0)} MB). Max is ${MAX_SIZE_MB} MB.`
    return null
  }, [])

  const handleFile = useCallback((file) => {
    if (!file) return
    const err = validate(file)
    if (err) {
      onFile(null, err)
      return
    }
    onFile(file, null)
  }, [validate, onFile])

  const onDragOver = (e) => { e.preventDefault(); setIsDragging(true) }
  const onDragLeave = () => setIsDragging(false)
  const onDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    handleFile(file)
  }
  const onInputChange = (e) => {
    handleFile(e.target.files?.[0])
    e.target.value = '' // reset
  }

  return (
    <div
      className={`upload-zone ${isDragging ? 'dragging' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => !uploading && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
      aria-label="Upload video"
      style={{ cursor: uploading ? 'default' : 'pointer' }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".mp4,.mov,.webm"
        onChange={onInputChange}
        style={{ display: 'none' }}
        id="video-file-input"
      />

      {uploading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ position: 'relative', width: 56, height: 56 }}>
            {/* Spinner */}
            <svg
              className="animate-spin"
              width="56" height="56" viewBox="0 0 56 56" fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="28" cy="28" r="24" stroke="var(--border)" strokeWidth="3"/>
              <path
                d="M28 4 A24 24 0 0 1 52 28"
                stroke="var(--accent)"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontSize: 15 }}>
            Uploading & extracting frames…
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          {/* Upload icon */}
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'var(--accent-glow2)',
            border: '2px solid var(--border-glow)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s',
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>

          <div style={{ textAlign: 'center' }}>
            <p style={{
              fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18,
              color: isDragging ? 'var(--accent-light)' : 'var(--text-primary)',
              marginBottom: 8, transition: 'color 0.2s'
            }}>
              {isDragging ? 'Drop to upload' : 'Drop your video here'}
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 4 }}>
              or <span style={{ color: 'var(--accent-light)', textDecoration: 'underline' }}>browse files</span>
            </p>
            <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>
              MP4 · MOV · WebM — max {MAX_SIZE_MB} MB
            </p>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--error-glow)', border: '1px solid var(--error)',
          borderRadius: 8, padding: '8px 16px',
          color: 'var(--error)', fontSize: 13, whiteSpace: 'nowrap',
          animation: 'fadeIn 0.2s ease'
        }}>
          ⚠ {error}
        </div>
      )}
    </div>
  )
}
