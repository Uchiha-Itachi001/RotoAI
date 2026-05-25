import { useEffect, useRef, useCallback } from 'react'
import { getApiUrl } from '../api/client'

/**
 * useWebSocket — connects to ws://localhost:8000/ws/{sessionId}
 * and forwards parsed JSON messages to onMessage.
 *
 * Automatically reconnects on disconnect (up to maxRetries times).
 */
export const useWebSocket = (sessionId, onMessage, { maxRetries = 5, retryDelay = 2000 } = {}) => {
  const wsRef = useRef(null)
  const retriesRef = useRef(0)
  const timerRef = useRef(null)
  const activeRef = useRef(true)

  const connect = useCallback(() => {
    if (!sessionId || !activeRef.current) return

    const base = getApiUrl()
    let wsUrl
    if (base) {
      const wsProtocol = base.startsWith('https:') ? 'wss:' : 'ws:'
      const cleanBase = base.replace(/^https?:\/\//, '')
      wsUrl = `${wsProtocol}//${cleanBase}/ws/${sessionId}`
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.hostname
      const port = import.meta.env.DEV ? '8000' : window.location.port
      wsUrl = `${protocol}//${host}:${port}/ws/${sessionId}`
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      retriesRef.current = 0
      // Send periodic pings to keep the connection alive
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping')
        } else {
          clearInterval(pingInterval)
        }
      }, 25000)
      ws._pingInterval = pingInterval
    }

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data !== 'pong') onMessage(data)
      } catch {
        // ignore non-JSON (e.g. plain "pong")
      }
    }

    ws.onerror = (e) => {
      console.warn('[WS] error:', e)
    }

    ws.onclose = () => {
      clearInterval(ws._pingInterval)
      if (!activeRef.current) return
      if (retriesRef.current < maxRetries) {
        retriesRef.current++
        timerRef.current = setTimeout(connect, retryDelay)
      }
    }
  }, [sessionId, onMessage, maxRetries, retryDelay])

  useEffect(() => {
    activeRef.current = true
    connect()
    return () => {
      activeRef.current = false
      clearTimeout(timerRef.current)
      if (wsRef.current) {
        clearInterval(wsRef.current._pingInterval)
        wsRef.current.close()
      }
    }
  }, [connect])

  const disconnect = useCallback(() => {
    activeRef.current = false
    clearTimeout(timerRef.current)
    wsRef.current?.close()
  }, [])

  return { disconnect }
}
