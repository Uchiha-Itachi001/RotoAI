import { useState, useCallback } from 'react'

const STORAGE_KEY = 'rotoai_sessions'
const MAX_RECENT = 8

/**
 * useSession — manages session state and localStorage persistence.
 *
 * Returns:
 *   session     — { id, firstFrameB64, totalFrames, fps, width, height }
 *   setSession  — set full session object
 *   recentSessions — array of recent { id, filename, timestamp }
 *   saveRecent  — persist a session to recent list
 *   clearRecent — wipe recent list
 */
export const useSession = () => {
  const [session, setSession] = useState(null)

  const loadRecent = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    } catch {
      return []
    }
  }, [])

  const saveRecent = useCallback((sessionId, filename) => {
    const existing = loadRecent().filter(s => s.id !== sessionId)
    const updated = [
      { id: sessionId, filename, timestamp: Date.now() },
      ...existing,
    ].slice(0, MAX_RECENT)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }, [loadRecent])

  const clearRecent = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const recentSessions = loadRecent()

  return { session, setSession, recentSessions, saveRecent, clearRecent }
}
