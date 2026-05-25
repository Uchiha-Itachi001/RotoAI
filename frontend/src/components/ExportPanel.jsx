/**
 * ExportPanel — format + quality selector and export trigger.
 *
 * Props:
 *   onExport(mode, quality) — called when user clicks Export
 *   exporting               — bool: show spinner
 *   downloadUrl             — string: show download button when ready
 *   error                   — string: error message
 */

const FORMATS = [
  {
    id: 'bw_matte',
    label: 'B&W Matte',
    emoji: '⬜',
    description: 'White subject on solid black background. Classic VFX workflow.',
    ext: 'MP4',
  },
  {
    id: 'alpha',
    label: 'Alpha Channel',
    emoji: '✨',
    description: 'Transparent background. Perfect for compositing in any NLE.',
    ext: 'WebM',
  },
  {
    id: 'greenscreen',
    label: 'Greenscreen',
    emoji: '🟩',
    description: 'Subject on solid green background. Drop into any chroma key workflow.',
    ext: 'MP4',
  },
]

const QUALITY_OPTIONS = [
  { id: 'draft', label: 'Draft', description: 'Faster — slightly compressed' },
  { id: 'full',  label: 'Full',  description: 'Best quality — slower export' },
]

import { useState } from 'react'

export default function ExportPanel({ onExport, exporting = false, downloadUrl = null, error = null }) {
  const [selectedMode, setSelectedMode] = useState('bw_matte')
  const [selectedQuality, setSelectedQuality] = useState('draft')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Format cards */}
      <div>
        <h3 style={{ marginBottom: 16, fontFamily: 'var(--font-display)' }}>Export Format</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {FORMATS.map(fmt => (
            <button
              key={fmt.id}
              className={`export-card ${selectedMode === fmt.id ? 'selected' : ''}`}
              onClick={() => setSelectedMode(fmt.id)}
              id={`export-format-${fmt.id}`}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>{fmt.emoji}</div>
              <div style={{
                fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14,
                marginBottom: 6, color: selectedMode === fmt.id ? 'var(--accent-light)' : 'var(--text-primary)'
              }}>
                {fmt.label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {fmt.description}
              </div>
              <div style={{ marginTop: 10 }}>
                <span className="badge badge-accent" style={{ fontSize: 10 }}>{fmt.ext}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Quality toggle */}
      <div>
        <h3 style={{ marginBottom: 12, fontFamily: 'var(--font-display)' }}>Quality</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {QUALITY_OPTIONS.map(q => (
            <button
              key={q.id}
              id={`quality-${q.id}`}
              onClick={() => setSelectedQuality(q.id)}
              style={{
                flex: 1, padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${selectedQuality === q.id ? 'var(--accent)' : 'var(--border)'}`,
                background: selectedQuality === q.id ? 'var(--accent-glow2)' : 'var(--bg-card)',
                cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left',
              }}
            >
              <div style={{
                fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14,
                color: selectedQuality === q.id ? 'var(--accent-light)' : 'var(--text-primary)',
                marginBottom: 4,
              }}>
                {q.label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{q.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: 'var(--radius-md)',
          background: 'var(--error-glow)', border: '1px solid var(--error)',
          color: 'var(--error)', fontSize: 14,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12 }}>
        {!downloadUrl ? (
          <button
            className="btn btn-primary btn-lg"
            style={{ flex: 1 }}
            onClick={() => onExport(selectedMode, selectedQuality)}
            disabled={exporting}
            id="export-btn"
          >
            {exporting ? (
              <>
                <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                  <path d="M12 2 A10 10 0 0 1 22 12" strokeLinecap="round"/>
                </svg>
                Exporting…
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export Video
              </>
            )}
          </button>
        ) : (
          <a
            href={downloadUrl}
            download
            className="btn btn-primary btn-lg"
            style={{ flex: 1, textDecoration: 'none' }}
            id="download-btn"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download {FORMATS.find(f => f.id === selectedMode)?.ext}
          </a>
        )}
      </div>
    </div>
  )
}
