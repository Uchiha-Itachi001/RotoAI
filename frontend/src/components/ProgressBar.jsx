/**
 * ProgressBar — animated progress bar with shimmer.
 *
 * Props:
 *   value      — 0-100
 *   label      — optional text below bar
 *   sublabel   — optional secondary text
 *   animated   — bool: whether to show shimmer (default true when processing)
 */
export default function ProgressBar({ value = 0, label, sublabel, animated = true }) {
  const pct = Math.max(0, Math.min(100, value))

  return (
    <div style={{ width: '100%' }}>
      {/* Labels */}
      {(label || sublabel) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, alignItems: 'baseline' }}>
          {label && (
            <span style={{ color: 'var(--text-secondary)', fontSize: 14, fontFamily: 'var(--font-display)', fontWeight: 500 }}>
              {label}
            </span>
          )}
          {sublabel && (
            <span style={{ color: 'var(--accent-light)', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 600 }}>
              {sublabel}
            </span>
          )}
        </div>
      )}

      {/* Track */}
      <div className="progress-track">
        <div
          className={`progress-fill ${animated && pct < 100 ? '' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Percentage */}
      <div style={{ textAlign: 'right', marginTop: 6 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          {pct.toFixed(0)}%
        </span>
      </div>
    </div>
  )
}
