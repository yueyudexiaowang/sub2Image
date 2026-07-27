export type CanvasRoute =
  | { type: 'list' }
  | { type: 'document'; docId: string }
  | { type: 'not-found' }

export const CANVAS_ROOT_PATH = '/app/canvas'

export function isCanvasPath(pathname: string) {
  return pathname === CANVAS_ROOT_PATH || pathname.startsWith(`${CANVAS_ROOT_PATH}/`)
}

export function parseCanvasRoute(pathname: string): CanvasRoute | null {
  if (!isCanvasPath(pathname)) return null
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts.length === 2) return { type: 'list' }
  if (parts.length !== 3) return { type: 'not-found' }

  try {
    const docId = decodeURIComponent(parts[2])
    if (!docId || docId.includes('/')) return { type: 'not-found' }
    return { type: 'document', docId }
  } catch {
    return { type: 'not-found' }
  }
}

function navigate(path: string) {
  if (window.location.pathname === path) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function navigateToCanvas(docId?: string) {
  navigate(docId ? `${CANVAS_ROOT_PATH}/${encodeURIComponent(docId)}` : CANVAS_ROOT_PATH)
}

export function leaveCanvas() {
  navigate('/app')
}
