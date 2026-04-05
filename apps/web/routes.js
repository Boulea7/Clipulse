export function buildHomeHash() {
  return '#/'
}

export function buildProjectHash(projectRef) {
  return `#/projects/${encodeURIComponent(projectRef)}`
}

export function buildSessionHash(sessionId, projectRef = '') {
  const encodedSessionId = encodeURIComponent(sessionId)
  if (!projectRef) {
    return `#/sessions/${encodedSessionId}`
  }

  return `#/sessions/${encodeURIComponent(projectRef)}/${encodedSessionId}`
}

export function parseDashboardHash(hash) {
  if (!hash || hash === '#' || hash === '#/') {
    return { view: 'home' }
  }

  const normalized = hash.startsWith('#/') ? hash.slice(2) : hash.replace(/^#/, '')
  const parts = normalized.split('/').filter(Boolean)

  if (parts[0] === 'projects' && parts[1]) {
    return { view: 'project', projectRef: decodeURIComponent(parts[1]) }
  }

  if (parts[0] === 'sessions' && parts[1]) {
    if (parts[2]) {
      return {
        view: 'session',
        projectRef: decodeURIComponent(parts[1]),
        sessionId: decodeURIComponent(parts[2]),
      }
    }

    return { view: 'session', sessionId: decodeURIComponent(parts[1]) }
  }

  return { view: 'home' }
}
