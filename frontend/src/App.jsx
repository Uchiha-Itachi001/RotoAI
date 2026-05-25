import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Canvas from './pages/Canvas'
import Processing from './pages/Processing'
import Export from './pages/Export'

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ background: 'var(--bg-primary)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/"                           element={<Home />} />
          <Route path="/canvas/:sessionId"          element={<Canvas />} />
          <Route path="/processing/:sessionId"      element={<Processing />} />
          <Route path="/export/:sessionId"          element={<Export />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
