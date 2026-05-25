import { Link, useLocation } from 'react-router-dom'
import BackendStatus from './BackendStatus'

const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="14" cy="14" r="13" stroke="url(#lg)" strokeWidth="2"/>
    <circle cx="14" cy="14" r="7" fill="url(#lg2)" opacity="0.8"/>
    <circle cx="14" cy="14" r="3" fill="#fff"/>
    <defs>
      <linearGradient id="lg" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
        <stop stopColor="#8b84ff"/>
        <stop offset="1" stopColor="#6c63ff"/>
      </linearGradient>
      <linearGradient id="lg2" x1="7" y1="7" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop stopColor="#6c63ff"/>
        <stop offset="1" stopColor="#4e47cc"/>
      </linearGradient>
    </defs>
  </svg>
)

export default function Navbar() {
  const location = useLocation()
  const isHome = location.pathname === '/'

  return (
    <nav className="navbar glass" style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 1280, margin: '0 auto' }}>
        {/* Brand */}
        <Link
          to="/"
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            textDecoration: 'none', color: 'inherit'
          }}
        >
          <Logo />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>
            Roto<span style={{ color: 'var(--accent-light)' }}>AI</span>
          </span>
        </Link>

        {/* Nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BackendStatus />
          <a
            href="https://github.com/facebookresearch/sam2"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 13 }}
          >
            SAM 2 docs
          </a>
          <span
            className="badge badge-accent"
            style={{ fontSize: 10 }}
          >
            v1.0
          </span>
        </div>
      </div>
    </nav>
  )
}
