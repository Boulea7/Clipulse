export const RECENT_SESSIONS_PATH = '/api/v1/sessions/recent?limit=10'
export const COMPACT_RECENT_SESSIONS_PATH = `${RECENT_SESSIONS_PATH}&compact=true`

export function buildProjectSessionsPath(projectRef) {
  return `/api/v1/projects/${encodeURIComponent(projectRef)}/sessions?limit=10`
}

export function buildCompactProjectSessionsPath(projectRef) {
  return `${buildProjectSessionsPath(projectRef)}&compact=true`
}

export function getRecentSessionListPaths() {
  return [COMPACT_RECENT_SESSIONS_PATH, RECENT_SESSIONS_PATH]
}

export function getProjectSessionListPaths(projectRef) {
  return [buildCompactProjectSessionsPath(projectRef), buildProjectSessionsPath(projectRef)]
}
