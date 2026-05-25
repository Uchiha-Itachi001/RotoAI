/**
 * Centralized API client for all RotoAI backend calls.
 */

// Clean up any legacy localStorage ROTOAI_API_URL references to ensure strict local focus
if (typeof window !== 'undefined' && window.localStorage) {
  localStorage.removeItem('ROTOAI_API_URL')
}

export const getApiUrl = () => {
  return import.meta.env.VITE_API_URL || ''
}

const getBase = () => {
  return getApiUrl() + '/api'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function request(url, options = {}) {
  const res = await fetch(url, options)
  
  // Guard against non-JSON (like bad gateway HTML or error page)
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    const text = await res.text()
    throw new Error(`Expected JSON response, but got HTML or other format. Status: ${res.status}. Data: ${text.slice(0, 100)}`)
  }

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.detail || `Request failed: ${res.status}`)
  }
  return data
}

// ─── API Methods ──────────────────────────────────────────────────────────────

export const api = {
  /**
   * Fetch backend server health.
   */
  health: async () => {
    return request(`${getBase()}/health`)
  },

  /**
   * Upload a video file.
   * @param {File} file
   * @returns {{ session_id, first_frame_b64, total_frames, fps, width, height }}
   */
  upload: async (file, startTime = 0.0, endTime = -1.0, fps = -1.0) => {
    const form = new FormData()
    form.append('file', file)
    form.append('start_time', startTime)
    form.append('end_time', endTime)
    form.append('fps', fps)
    return request(`${getBase()}/upload`, { method: 'POST', body: form })
  },

  /**
   * Get a mask preview for a specific frame.
   * @param {string} session_id
   * @param {number} frame_idx
   * @param {Array}  points       [[x,y],...]
   * @param {Array}  labels       [1,0,...]
   * @param {Array}  strokes      [{ points: [[x,y],...], radius, label }]
   * @param {Array|null} box      [x1,y1,x2,y2] optional
   * @param {Object} finesse      finesse parameters
   * @param {string} overlay_mode overlay style ("rubylith", "color", "highlight", "outline", "bw")
   * @returns {{ mask_b64, overlay_b64 }}
   */
  previewMask: async (session_id, frame_idx, points, labels, strokes = [], box = null, finesse = {}, overlay_mode = "rubylith") => {
    return request(`${getBase()}/preview_mask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id, frame_idx, points, labels, strokes, box, finesse, overlay_mode }),
    })
  },

  /**
   * Apply mask finesse sliders to an existing raw mask.
   * @param {string} session_id
   * @param {number} frame_idx
   * @param {Object} finesse      finesse parameters
   * @param {string} overlay_mode overlay style
   * @returns {{ mask_b64, overlay_b64 }}
   */
  finesseMask: async (session_id, frame_idx, finesse, overlay_mode = "rubylith") => {
    return request(`${getBase()}/finesse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id, frame_idx, finesse, overlay_mode }),
    })
  },

  /**
   * Fetch a frame and its mask/overlay as base64.
   * @param {string} session_id
   * @param {number} frame_idx
   * @returns {{ frame_b64, mask_b64, overlay_b64 }}
   */
  getFrame: async (session_id, frame_idx) => {
    return request(`${getBase()}/frame/${session_id}/${frame_idx}`)
  },

  /**
   * Start video processing (directional mask propagation).
   * @param {string} session_id
   * @param {string} direction   "forward" | "backward"
   * @param {number} start_frame 0-indexed starting frame
   * @returns {{ status, session_id }}
   */
  process: async (session_id, direction = 'forward', start_frame = 0) => {
    return request(`${getBase()}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id, direction, start_frame }),
    })
  },

  /**
   * Start export in given mode.
   * @param {string} mode  "bw_matte" | "alpha" | "greenscreen"
   * @param {string} quality "draft" | "full"
   * @returns {{ status, download_url }}
   */
  exportVideo: async (session_id, mode, quality) => {
    return request(`${getBase()}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id, mode, quality }),
    })
  },

  /**
   * Poll export status.
   * @returns {{ status, download_url?, message? }}
   */
  exportStatus: async (session_id) => {
    return request(`${getBase()}/export/status/${session_id}`)
  },

  /**
   * Delete session and cancel processing.
   */
  deleteSession: async (session_id) => {
    return request(`${getBase()}/session/${session_id}`, { method: 'DELETE' })
  },

  /**
   * Get session metadata.
   */
  getSession: async (session_id) => {
    return request(`${getBase()}/session/${session_id}`)
  },

  /**
   * Get active AI model status.
   */
  getModelStatus: async () => {
    return request(`${getBase()}/model_status`)
  },
}
