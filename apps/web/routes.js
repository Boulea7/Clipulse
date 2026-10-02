export function buildHomeHash() {
  return '#/'
}

export function buildReportsHash() {
  return '#/reports'
}

export function buildProvidersHash() {
  return '#/providers'
}

export function buildSettingsHash() {
  return '#/settings'
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

  if (parts.length === 1 && ['reports', 'providers', 'settings'].includes(parts[0])) {
    return { view: parts[0] }
  }

  if (parts[0] === 'projects' && parts.length === 2 && parts[1]) {
    const projectRef = safeDecodeURIComponent(parts[1])
    return projectRef ? { view: 'project', projectRef } : { view: 'home' }
  }

  if (parts[0] === 'sessions') {
    if (parts.length === 3 && parts[1] && parts[2]) {
      const projectRef = safeDecodeURIComponent(parts[1])
      const sessionId = safeDecodeURIComponent(parts[2])
      if (!projectRef || !sessionId) {
        return { view: 'home' }
      }

      return {
        view: 'session',
        projectRef,
        sessionId,
      }
    }

    if (parts.length === 2 && parts[1]) {
      const sessionId = safeDecodeURIComponent(parts[1])
      return sessionId ? { view: 'session', sessionId } : { view: 'home' }
    }
  }

  return { view: 'home' }
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}
