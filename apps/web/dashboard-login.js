const root = document.getElementById('dashboard-login-root')
const form = document.getElementById('dashboard-login-form')
const localeInput = document.getElementById('dashboard-locale')
const submitButton = document.getElementById('dashboard-login-submit')
const tokenInput = document.getElementById('dashboard-token')
const errorNode = document.getElementById('dashboard-login-error')

if (
  root instanceof HTMLElement
  && form instanceof HTMLFormElement
  && localeInput instanceof HTMLSelectElement
  && submitButton instanceof HTMLButtonElement
  && tokenInput instanceof HTMLInputElement
  && errorNode instanceof HTMLElement
) {
  const localeCookieWrites = readLocaleCookieWrites(root.dataset.localeCookieWrites)
  const loginPath = root.dataset.loginPath ?? './dashboard-login'
  const invalidTokenMessage = root.dataset.invalidToken ?? 'Invalid token.'
  const failedMessage = root.dataset.failed ?? 'Dashboard login failed.'
  const networkFailedMessage = root.dataset.networkFailed ?? 'Could not reach the Clipulse server.'

  localeInput.addEventListener('change', () => {
    writeLocaleCookies(localeCookieWrites, localeInput.value)
    const nextUrl = new URL(window.location.href)
    window.location.replace(nextUrl.toString())
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    errorNode.textContent = ''
    tokenInput.setAttribute('aria-invalid', 'false')
    submitButton.disabled = true

    try {
      const response = await fetch(loginPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.value }),
      })

      if (response.ok) {
        writeLocaleCookies(localeCookieWrites, localeInput.value)
        const nextUrl = new URL('./', window.location.href)
        nextUrl.hash = window.location.hash
        window.location.replace(nextUrl.toString())
        return
      }

      errorNode.textContent = response.status === 401
        ? invalidTokenMessage
        : failedMessage
      tokenInput.setAttribute('aria-invalid', 'true')
      tokenInput.focus()
      if (response.status === 401) {
        tokenInput.select()
      }
    } catch {
      errorNode.textContent = networkFailedMessage
      tokenInput.setAttribute('aria-invalid', 'true')
      tokenInput.focus()
    } finally {
      submitButton.disabled = false
    }
  })
}

function readLocaleCookieWrites(rawValue) {
  if (!rawValue) {
    return []
  }

  try {
    const parsed = JSON.parse(rawValue)
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : []
  } catch {
    return []
  }
}

function writeLocaleCookies(cookieWrites, localeValue) {
  for (const statement of cookieWrites) {
    document.cookie = statement.replace('__LOCALE__', encodeURIComponent(localeValue))
  }
}
