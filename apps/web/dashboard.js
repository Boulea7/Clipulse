import {
  renderDetailPanel,
  renderLinkList,
  renderMetricList,
  renderSectionTitle,
  renderTimeseries,
} from './dom.js'
import {
  buildHostLines,
  buildLanguageLines,
  buildModelLines,
  buildOverviewLines,
  buildProjectListItems,
  buildRecentSessionItems,
  buildTimeseriesRows,
  buildDetailEntries,
  formatCompatibilitySummary,
} from './view-models.js'
import {
  buildHomeHash,
  buildProjectHash,
  buildProvidersHash,
  buildReportsHash,
  buildSessionHash,
  buildSettingsHash,
  parseDashboardHash,
} from './routes.js'
import { getProjectSessionListPaths, getRecentSessionListPaths } from './session-list-paths.js'
import {
  getCurrentLocale,
  getLocaleOptions,
  resolveDashboardLocale,
  setCurrentLocale,
  t,
  translateText,
  writeLocaleCookie,
} from './i18n.js'

const DASHBOARD_COMPAT_FALLBACK = {
  languageBreakdownItem: {
    text: ['name'],
    number: ['changed'],
  },
  modelBreakdownItem: {
    text: ['name'],
    number: ['active_ms', 'events'],
  },
  hostBreakdownItem: {
    text: ['name'],
    number: ['active_ms', 'events'],
  },
  projectTopItem: {
    text: ['project_name', 'project_ref', 'last_event_time'],
    number: ['active_ms', 'wait_ms', 'changed_files_count', 'lines_changed', 'host_model_mix_count'],
    anyText: [
      { label: 'last_host', fields: ['last_host'] },
      { label: 'last_model_name', fields: ['last_model_name'] },
      { label: 'last_git_branch', fields: ['last_git_branch'] },
    ],
    anyNumber: [{ label: 'event_count/events', fields: ['event_count', 'events'] }],
  },
  sessionListItem: {
    text: ['session_id', 'project_name', 'project_ref', 'last_event_time'],
    number: ['active_ms', 'wait_ms', 'changed_files_count', 'lines_changed', 'host_model_mix_count'],
    anyText: [
      { label: 'host', fields: ['host', 'last_host'] },
      { label: 'model_name', fields: ['model_name', 'last_model_name'] },
      { label: 'git_branch', fields: ['git_branch', 'last_git_branch'] },
    ],
    anyNumber: [{ label: 'event_count/events', fields: ['event_count', 'events'] }],
  },
  projectDetail: {
    text: ['project_name', 'project_ref'],
    number: [
      'active_ms',
      'wait_ms',
      'session_count',
      'changed_files_count',
      'changed_languages_count',
      'lines_added',
      'lines_removed',
      'lines_changed',
    ],
    anyNumber: [{ label: 'event_count/events', fields: ['event_count', 'events'] }],
  },
  sessionDetail: {
    text: ['session_id', 'project_name', 'project_ref', 'last_event_time'],
    number: [
      'active_ms',
      'wait_ms',
      'changed_files_count',
      'changed_languages_count',
      'lines_added',
      'lines_removed',
      'lines_changed',
    ],
    anyText: [
      { label: 'host', fields: ['host', 'last_host'] },
      { label: 'model_name', fields: ['model_name', 'last_model_name'] },
      { label: 'git_branch', fields: ['git_branch', 'last_git_branch'] },
    ],
    anyNumber: [{ label: 'event_count/events', fields: ['event_count', 'events'] }],
  },
  timeseriesItem: {
    text: ['date'],
    number: ['active_ms', 'wait_ms', 'events'],
  },
}

const DASHBOARD_COMPAT_SECTION_NAMES = Object.keys(DASHBOARD_COMPAT_FALLBACK)
const DASHBOARD_COMPAT_SECTION_LABELS = {
  languageBreakdownItem: 'language breakdown',
  modelBreakdownItem: 'model breakdown',
  hostBreakdownItem: 'host breakdown',
  projectTopItem: 'top projects list',
  sessionListItem: 'recent sessions list',
  projectDetail: 'project detail',
  sessionDetail: 'session detail',
  timeseriesItem: 'activity chart',
}
const DASHBOARD_COMPAT_META_FALLBACK = {
  artifact: 'clipulse.dashboard-compat',
  version: 'v1',
  description: 'Dashboard-side compatibility contract for summary, list, and detail payload validation with field-aware drift diagnostics.',
  sections: DASHBOARD_COMPAT_SECTION_NAMES,
  section_count: DASHBOARD_COMPAT_SECTION_NAMES.length,
}
const VALID_BACKLOG_MODES = new Set([
  'missing_state_dir',
  'empty',
  'pending',
  'processing_only',
  'quarantine_only',
  'mixed',
  'unavailable',
])
const VALID_STATE_DIR_KINDS = new Set(['directory', 'file', 'missing'])

const dashboardCompatContractUrl = new URL('../../contracts/dashboard-compat.v1.json', import.meta.url)

function getDashboardBasePath(pathname) {
  if (!hasText(pathname) || pathname === '/') {
    return ''
  }

  const trimmedPath = pathname.trim()
  const normalizedPath = trimmedPath.endsWith('/') && trimmedPath.length > 1
    ? trimmedPath.slice(0, -1)
    : trimmedPath

  if (!normalizedPath || normalizedPath === '/') {
    return ''
  }

  const lastSegment = normalizedPath.split('/').pop() ?? ''
  if (!lastSegment.includes('.')) {
    return normalizedPath
  }

  const lastSlashIndex = normalizedPath.lastIndexOf('/')
  if (lastSlashIndex <= 0) {
    return ''
  }

  return normalizedPath.slice(0, lastSlashIndex)
}

function buildDashboardResourcePath(basePath, resourcePath) {
  const normalizedBasePath = basePath === '/' ? '' : basePath
  return `${normalizedBasePath}${resourcePath}`
}

function normalizeCompatHash(value) {
  if (!hasText(value)) {
    return null
  }

  const trimmedValue = value.trim().toLowerCase()
  return /^sha256:[0-9a-f]{64}$/.test(trimmedValue) ? trimmedValue : null
}

async function computeCompatHash(sourceText) {
  const encodedText = new TextEncoder().encode(sourceText)

  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encodedText)
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `sha256:${hash}`
  }

  const { createHash } = await import('node:crypto')
  return `sha256:${createHash('sha256').update(encodedText).digest('hex')}`
}

function getSections(doc) {
  return {
    brandSubtitle: doc.querySelector('#brand-subtitle'),
    heroTitle: doc.querySelector('#hero-title'),
    heroDescription: doc.querySelector('#hero-description'),
    panelEyebrow: doc.querySelector('#panel-eyebrow'),
    panelStatusLabel: doc.querySelector('#panel-status-label'),
    viewNav: doc.querySelector('#view-nav'),
    viewTitle: doc.querySelector('#view-title'),
    viewDescription: doc.querySelector('#view-description'),
    dashboardAuth: doc.querySelector('#dashboard-auth'),
    localeSwitcherLabel: doc.querySelector('#locale-switcher-label'),
    localeSwitcher: doc.querySelector('#locale-switcher'),
    logoutButton: doc.querySelector('#logout-button'),
    authStatus: doc.querySelector('#auth-status'),
    overviewTitle: doc.querySelector('#overview-title'),
    languagesTitle: doc.querySelector('#languages-title'),
    modelsTitle: doc.querySelector('#models-title'),
    hostsTitle: doc.querySelector('#hosts-title'),
    projectsTitle: doc.querySelector('#projects-title'),
    detailTitle: doc.querySelector('#detail-title'),
    detailDescription: doc.querySelector('#detail-description'),
    overview: doc.querySelector('#overview'),
    languages: doc.querySelector('#languages'),
    models: doc.querySelector('#models'),
    hosts: doc.querySelector('#hosts'),
    projects: doc.querySelector('#projects'),
    sessionsTitle: doc.querySelector('#sessions-title'),
    sessions: doc.querySelector('#sessions'),
    timeseriesTitle: doc.querySelector('#timeseries-title'),
    timeseries: doc.querySelector('#timeseries'),
    reportsTitle: doc.querySelector('#reports-title'),
    reports: doc.querySelector('#reports'),
    providersTitle: doc.querySelector('#providers-title'),
    providers: doc.querySelector('#providers'),
    settingsTitle: doc.querySelector('#settings-title'),
    settings: doc.querySelector('#settings'),
  }
}

function getPreferredLocales(win) {
  const navigatorLanguages = Array.isArray(win?.navigator?.languages) ? win.navigator.languages : []
  if (navigatorLanguages.length > 0) {
    return navigatorLanguages
  }

  if (hasText(win?.navigator?.language)) {
    return [win.navigator.language]
  }

  return []
}

function updateStaticChrome(sections) {
  renderSectionTitle(sections.brandSubtitle, t('shell.brandSubtitle'))
  renderSectionTitle(sections.heroTitle, t('shell.heroTitle'))
  renderSectionTitle(sections.heroDescription, t('shell.heroDescription'))
  renderSectionTitle(sections.panelEyebrow, t('shell.panelEyebrow'))
  renderSectionTitle(sections.panelStatusLabel, t('shell.panelStatusLabel'))
  renderSectionTitle(sections.overviewTitle, t('section.overview'))
  renderSectionTitle(sections.languagesTitle, t('section.languages'))
  renderSectionTitle(sections.modelsTitle, t('section.models'))
  renderSectionTitle(sections.hostsTitle, t('section.hosts'))
  renderSectionTitle(sections.projectsTitle, t('section.projects'))
  renderSectionTitle(sections.timeseriesTitle, t('section.dailyActivity'))
  renderSectionTitle(sections.reportsTitle, t('section.reports'))
  renderSectionTitle(sections.providersTitle, t('section.providers'))
  renderSectionTitle(sections.settingsTitle, t('section.settings'))
  renderSectionTitle(sections.localeSwitcherLabel, t('locale.label'))
}

function renderLocaleSwitcher(doc, sections, locale) {
  if (!sections.localeSwitcher) {
    return
  }

  const options = getLocaleOptions().map((option) => {
    const node = doc.createElement('option')
    node.value = option.value
    node.textContent = option.label
    return node
  })

  sections.localeSwitcher.replaceChildren(...options)
  sections.localeSwitcher.value = locale
  renderSectionTitle(sections.localeSwitcherLabel, t('locale.label'))
}

async function loadJson(path, fetchImpl) {
  const response = await fetchImpl(path)

  if (!response.ok) {
    let errorBody = null
    try {
      errorBody = await response.json()
    } catch {
      errorBody = null
    }
    const detailPayload = errorBody?.detail && typeof errorBody.detail === 'object'
      ? errorBody.detail
      : null

    const error = new Error(`Failed to load ${path}`)
    error.status = response.status ?? 0
    error.code = detailPayload?.code ?? null
    error.detail = detailPayload?.message ?? errorBody?.detail ?? null
    error.hint = detailPayload?.hint ?? null
    throw error
  }

  try {
    return await response.json()
  } catch {
    const error = new Error(`Failed to parse ${path}`)
    error.status = response.status ?? 0
    error.code = 'invalid_json_response'
    error.detail = 'Invalid JSON response.'
    error.hint = 'Check the API response body and JSON serialization for this endpoint.'
    throw error
  }
}

function getSettledValue(result) {
  return result.status === 'fulfilled' ? result.value : null
}

function normalizeItemsPayload(payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  return {
    ...safePayload,
    items: Array.isArray(safePayload.items) ? safePayload.items : [],
  }
}

function getSettledError(result) {
  return result.status === 'rejected' ? toDetailError(result.reason) : null
}

function isAuthError(error) {
  return error?.status === 401 || error?.status === 403
}

function getProtectedDashboardErrorText(error) {
  if (error?.status === 401) {
    return 'Sign in required for this protected dashboard.'
  }

  if (error?.status === 403) {
    return 'This account cannot access the protected dashboard.'
  }

  return null
}

function createInvalidItemsPayloadError(
  detail = 'Invalid list payload.',
  hint = 'Check the list endpoint response shape.',
) {
  const error = new Error(detail)
  error.status = 200
  error.code = 'invalid_list_payload'
  error.detail = detail
  error.hint = hint
  return error
}

function createInvalidSummaryPayloadError(
  detail = 'Invalid summary payload.',
  hint = 'Check the summary endpoint response shape.',
) {
  const error = new Error(detail)
  error.status = 200
  error.code = 'invalid_summary_payload'
  error.detail = detail
  error.hint = hint
  return error
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasNumber(value) {
  return Number.isFinite(value)
}

function hasStringArray(value) {
  return Array.isArray(value) && value.every((item) => hasText(item))
}

function hasContractGroupArray(value) {
  return Array.isArray(value) && value.every((group) => (
    hasObject(group)
    && hasText(group.label)
    && hasStringArray(group.fields)
  ))
}

function hasRequiredContractFields(remoteSection, fallbackSection) {
  for (const fieldName of fallbackSection.text ?? []) {
    if (!remoteSection.text.includes(fieldName)) {
      return false
    }
  }

  for (const fieldName of fallbackSection.number ?? []) {
    if (!remoteSection.number.includes(fieldName)) {
      return false
    }
  }

  for (const fallbackGroup of fallbackSection.anyText ?? []) {
    const remoteGroup = (remoteSection.anyText ?? []).find((group) => group.label === fallbackGroup.label)
    if (!remoteGroup || !fallbackGroup.fields.every((fieldName) => remoteGroup.fields.includes(fieldName))) {
      return false
    }
  }

  for (const fallbackGroup of fallbackSection.anyNumber ?? []) {
    const remoteGroup = (remoteSection.anyNumber ?? []).find((group) => group.label === fallbackGroup.label)
    if (!remoteGroup || !fallbackGroup.fields.every((fieldName) => remoteGroup.fields.includes(fieldName))) {
      return false
    }
  }

  return true
}

function isCompleteContractSection(remoteSection, fallbackSection) {
  if (!hasObject(remoteSection)) {
    return false
  }

  if (!hasStringArray(remoteSection.text ?? [])) {
    return false
  }

  if (!hasStringArray(remoteSection.number ?? [])) {
    return false
  }

  if (!hasContractGroupArray(remoteSection.anyText ?? [])) {
    return false
  }

  if (!hasContractGroupArray(remoteSection.anyNumber ?? [])) {
    return false
  }

  return hasRequiredContractFields(remoteSection, fallbackSection)
}

function getDashboardCompatMeta(rawMeta) {
  const sanitizeMetaToken = (value, fallback) => {
    if (!hasText(value)) {
      return fallback
    }

    const trimmedValue = value.trim()
    return /^[A-Za-z0-9._-]+$/.test(trimmedValue) ? trimmedValue : fallback
  }

  const sanitizeMetaDescription = (value, fallback) => {
    if (!hasText(value)) {
      return fallback
    }

    return value.trim().replace(/\s+/g, ' ')
  }

  const sections = hasStringArray(rawMeta?.sections)
    ? rawMeta.sections
    : DASHBOARD_COMPAT_META_FALLBACK.sections

  return {
    artifact: sanitizeMetaToken(rawMeta?.artifact, DASHBOARD_COMPAT_META_FALLBACK.artifact),
    version: sanitizeMetaToken(rawMeta?.version, DASHBOARD_COMPAT_META_FALLBACK.version),
    description: sanitizeMetaDescription(rawMeta?.description, DASHBOARD_COMPAT_META_FALLBACK.description),
    sections,
    section_count: hasNumber(rawMeta?.section_count) ? rawMeta.section_count : sections.length,
  }
}

function formatDashboardCompatMeta(meta, builtIn = false) {
  const prefix = builtIn ? 'built-in ' : ''
  return `${prefix}${meta.artifact}@${meta.version} (${meta.section_count} sections)`
}

function summarizeFallbackSections(fallbackSections) {
  if (!fallbackSections.length) {
    return 'none'
  }

  if (fallbackSections.length === DASHBOARD_COMPAT_SECTION_NAMES.length) {
    return `all ${fallbackSections.length} sections`
  }

  const labels = fallbackSections.map((sectionName) => DASHBOARD_COMPAT_SECTION_LABELS[sectionName] ?? sectionName)
  const preview = labels.slice(0, 3)
  const remainingCount = Math.max(labels.length - preview.length, 0)
  const countLabel = `${labels.length} ${labels.length === 1 ? 'section' : 'sections'}`
  const previewLabel = remainingCount > 0
    ? `${preview.join(', ')}, +${remainingCount} more`
    : preview.join(', ')

  return `${countLabel}: ${previewLabel}`
}

function collectContractDriftFields(remoteSection, fallbackSection) {
  if (!hasObject(remoteSection)) {
    return []
  }

  if (
    !hasStringArray(remoteSection.text ?? [])
    || !hasStringArray(remoteSection.number ?? [])
    || !hasContractGroupArray(remoteSection.anyText ?? [])
    || !hasContractGroupArray(remoteSection.anyNumber ?? [])
  ) {
    return []
  }

  const driftFields = []

  for (const fieldName of fallbackSection.text ?? []) {
    if (!remoteSection.text.includes(fieldName)) {
      driftFields.push(fieldName)
    }
  }

  for (const fieldName of fallbackSection.number ?? []) {
    if (!remoteSection.number.includes(fieldName)) {
      driftFields.push(fieldName)
    }
  }

  return driftFields
}

function summarizeAffectedFieldDiagnostics(fieldDiagnostics) {
  const entries = (Array.isArray(fieldDiagnostics) ? fieldDiagnostics : [])
    .filter((item) => hasText(item?.sectionName) && Array.isArray(item?.fields) && item.fields.length > 0)
    .map((item) => {
      const sectionLabel = DASHBOARD_COMPAT_SECTION_LABELS[item.sectionName] ?? item.sectionName
      return `${sectionLabel}: ${item.fields.join(', ')}`
    })

  return entries.length > 0 ? entries.join(' . ') : null
}

function resolveDashboardCompatContract(rawContract, diagnostics = {}) {
  const resolvedContract = {}
  const fallbackSections = []
  const fallbackFieldDiagnostics = []

  for (const sectionName of DASHBOARD_COMPAT_SECTION_NAMES) {
    const fallbackSection = DASHBOARD_COMPAT_FALLBACK[sectionName]
    const remoteSection = rawContract?.[sectionName]
    if (isCompleteContractSection(remoteSection, fallbackSection)) {
      resolvedContract[sectionName] = remoteSection
      continue
    }

    resolvedContract[sectionName] = fallbackSection
    fallbackSections.push(sectionName)
    const driftFields = collectContractDriftFields(remoteSection, fallbackSection)
    if (driftFields.length > 0) {
      fallbackFieldDiagnostics.push({
        sectionName,
        fields: driftFields,
      })
    }
  }

  const usingFallback = fallbackSections.length > 0
  const isBuiltInOnly = !hasObject(rawContract)
  const meta = getDashboardCompatMeta(rawContract?._meta)
  const mode = isBuiltInOnly ? 'built-in' : usingFallback ? 'mixed' : 'remote'

  return {
    contract: resolvedContract,
    mode,
    usingFallback,
    fallbackSections,
    fallbackSectionsLabel: summarizeFallbackSections(fallbackSections),
    fallbackFieldDiagnostics,
    fallbackFieldDiagnosticsLabel: summarizeAffectedFieldDiagnostics(fallbackFieldDiagnostics),
    baseSourceKind: diagnostics.sourceKind ?? (isBuiltInOnly ? 'built_in' : usingFallback ? 'contract_drift' : 'remote_loaded'),
    sourceKind: diagnostics.sourceKind ?? (isBuiltInOnly ? 'built_in' : usingFallback ? 'contract_drift' : 'remote_loaded'),
    baseSource: diagnostics.source ?? (
      usingFallback
        ? 'Remote contract loaded with mixed-version/contract-drift sections; built-in fallback remains active where needed.'
        : 'remote contract loaded.'
    ),
    source: diagnostics.source ?? (
      usingFallback
        ? 'Remote contract loaded with mixed-version/contract-drift sections; built-in fallback remains active where needed.'
        : 'remote contract loaded.'
    ),
    meta,
    metaLabel: formatDashboardCompatMeta(isBuiltInOnly ? DASHBOARD_COMPAT_META_FALLBACK : meta, isBuiltInOnly),
    hash: normalizeCompatHash(diagnostics.hash),
  }
}

async function loadDashboardCompatContract(fetchImpl, contractPath) {
  if (typeof fetchImpl !== 'function') {
    try {
      const { readFileSync } = await import('node:fs')
      const contractText = readFileSync(dashboardCompatContractUrl, 'utf8')
      return resolveDashboardCompatContract(
        JSON.parse(contractText),
        {
          source: 'Bundled dashboard contract artifact loaded from the local filesystem.',
          sourceKind: 'local_file',
          hash: await computeCompatHash(contractText),
        },
      )
    } catch {
      return resolveDashboardCompatContract(null, {
        source: 'Bundled dashboard contract artifact could not be read; using built-in fallback.',
        sourceKind: 'read_failed',
      })
    }
  }

  try {
    const response = await fetchImpl(contractPath)
    if (!response?.ok) {
      return resolveDashboardCompatContract(null, {
        source: formatRemoteContractFailureSource(response?.status),
        sourceKind: 'fetch_failed',
      })
    }

    try {
      const contractText = await response.text()
      return resolveDashboardCompatContract(JSON.parse(contractText), {
        hash: await computeCompatHash(contractText),
      })
    } catch {
      return resolveDashboardCompatContract(null, {
        source: 'Remote contract returned invalid JSON; using built-in fallback.',
        sourceKind: 'invalid_json',
      })
    }
  } catch (error) {
    const message = hasText(error?.message) ? error.message : 'unknown error'
    return resolveDashboardCompatContract(null, {
      source: `Remote contract fetch failed before a response was available: ${message}; using built-in fallback.`,
      sourceKind: 'fetch_failed',
    })
  }
}

function formatRemoteContractFailureSource(status) {
  const statusCode = Number.isFinite(status) ? status : 0

  if (statusCode === 401 || statusCode === 403) {
    return `Remote contract fetch failed with status ${statusCode}; the public route may be behind auth or blocked by a proxy. Keep /contracts/dashboard-compat.v1.json readable from the dashboard deployment; using built-in fallback.`
  }

  if (statusCode === 404) {
    return 'Remote contract fetch failed with status 404; the public route for /contracts/dashboard-compat.v1.json is unavailable on this deployment. Check public-route rewrites and auth exceptions; using built-in fallback.'
  }

  return `Remote contract fetch failed with status ${statusCode}; using built-in fallback.`
}

function collectMissingContractFields(payload, contract) {
  const missingFields = []

  for (const fieldName of contract.text ?? []) {
    if (!hasText(payload?.[fieldName])) {
      missingFields.push(fieldName)
    }
  }

  for (const fieldName of contract.number ?? []) {
    if (!hasNumber(payload?.[fieldName])) {
      missingFields.push(fieldName)
    }
  }

  for (const group of contract.anyText ?? []) {
    if (!group.fields.some((fieldName) => hasText(payload?.[fieldName]))) {
      missingFields.push(group.label)
    }
  }

  for (const group of contract.anyNumber ?? []) {
    if (!group.fields.some((fieldName) => hasNumber(payload?.[fieldName]))) {
      missingFields.push(group.label)
    }
  }

  return missingFields
}

function normalizePayloadWithContract(payload, contract) {
  if (!hasObject(payload) || !hasObject(contract)) {
    return payload
  }

  const normalizedPayload = { ...payload }

  for (const group of contract.anyText ?? []) {
    const canonicalField = group.fields?.[0]
    if (hasText(normalizedPayload[canonicalField])) {
      continue
    }

    const aliasField = group.fields.find((fieldName) => hasText(normalizedPayload[fieldName]))
    if (aliasField && canonicalField) {
      normalizedPayload[canonicalField] = normalizedPayload[aliasField]
    }
  }

  for (const group of contract.anyNumber ?? []) {
    const canonicalField = group.fields?.[0]
    if (hasNumber(normalizedPayload[canonicalField])) {
      continue
    }

    const aliasField = group.fields.find((fieldName) => hasNumber(normalizedPayload[fieldName]))
    if (aliasField && canonicalField) {
      normalizedPayload[canonicalField] = normalizedPayload[aliasField]
    }
  }

  return normalizedPayload
}

function hasObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function validateItemsPayload(payload, hint, options = {}, contract = DASHBOARD_COMPAT_FALLBACK.sessionListItem) {
  const { projectRef = null, requireProjectName = false } = options

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
    throw createInvalidItemsPayloadError('Invalid list payload.', hint)
  }

  if (projectRef && (!hasText(payload.project_ref) || payload.project_ref !== projectRef)) {
    throw createInvalidItemsPayloadError('List payload does not match the current route project_ref.', hint)
  }

  if (requireProjectName && !hasText(payload.project_name)) {
    throw createInvalidItemsPayloadError('Missing required list fields: project_name', hint)
  }

  payload.items.forEach((item, index) => {
    const missingFields = collectMissingContractFields(item, contract)

    if (missingFields.length > 0) {
      throw createInvalidItemsPayloadError(
        `Missing required list item fields at index ${index}: ${missingFields.join(', ')}`,
        hint,
      )
    }

    if (projectRef && item.project_ref !== projectRef) {
      throw createInvalidItemsPayloadError(
        `List item at index ${index} does not match the current route project_ref.`,
        hint,
      )
    }
  })

  return {
    ...payload,
    items: payload.items.map((item) => normalizePayloadWithContract(item, contract)),
  }
}

function shouldRetryLegacyListPath(error) {
  if (error?.code === 'invalid_list_payload' || error?.code === 'invalid_json_response') {
    return true
  }

  return error?.status === 400
    || error?.status === 404
    || error?.status === 405
    || error?.status === 422
    || error?.status === 501
}

async function loadSessionListPayload(paths, fetchImpl, hint, options = {}, contract = DASHBOARD_COMPAT_FALLBACK.sessionListItem) {
  let lastError = null

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]
    try {
      const payload = await loadJson(path, fetchImpl)
      return validateItemsPayload(payload, hint, options, contract)
    } catch (error) {
      lastError = error
      const hasFallback = index < paths.length - 1
      if (!hasFallback || !shouldRetryLegacyListPath(error)) {
        throw error
      }
    }
  }

  throw lastError ?? createInvalidItemsPayloadError(hint)
}

function validateOverviewPayload(payload) {
  if (!hasObject(payload)) {
    throw createInvalidSummaryPayloadError(
      'Invalid overview payload.',
      'Check that /api/v1/overview returns an object with totals, today, or this_week windows.',
    )
  }

  if (hasObject(payload.totals) || hasObject(payload.today) || hasObject(payload.this_week)) {
    return payload
  }

  throw createInvalidSummaryPayloadError(
    'Invalid overview payload.',
    'Check that /api/v1/overview returns at least one of totals, today, or this_week as an object.',
  )
}

function validateSummaryItemsPayload(payload, label, path, contracts) {
  if (!hasObject(payload) || !Array.isArray(payload.items)) {
    throw createInvalidSummaryPayloadError(
      `Invalid ${label} payload.`,
      `Check that ${path} returns an object with an items array.`,
    )
  }

  const contract = contracts?.[label] ?? null

  payload.items.forEach((item, index) => {
    if (!hasObject(item)) {
      throw createInvalidSummaryPayloadError(
        `Invalid ${label} payload.`,
        `Check that ${path} returns an items array of objects.`,
      )
    }

    const missingFields = contract ? collectMissingContractFields(item, contract) : []
    if (missingFields.length > 0) {
      throw createInvalidSummaryPayloadError(
        `Invalid ${label} payload.`,
        `Check that ${path} item ${index} includes ${missingFields.join(', ')}.`,
      )
    }
  })

  return {
    ...payload,
    items: payload.items.map((item) => normalizePayloadWithContract(item, contract)),
  }
}

function validateStatusPayload(payload) {
  const metadataErrorCountsByState = payload?.spool?.metadata_error_counts_by_state
  const metadataCountsByStateValid = (
    hasObject(metadataErrorCountsByState)
    && ['ready', 'processing', 'quarantine'].every((state) => (
      hasObject(metadataErrorCountsByState[state])
      && hasNumber(metadataErrorCountsByState[state].read_error)
      && hasNumber(metadataErrorCountsByState[state].parse_error)
    ))
  )
  if (
    hasObject(payload?.api)
    && hasText(payload.api.status)
    && hasText(payload.api.version)
    && hasObject(payload?.auth)
    && typeof payload.auth.dashboard_auth_required === 'boolean'
    && typeof payload.auth.browser_session_enabled === 'boolean'
    && hasText(payload.auth.browser_session_scope)
    && hasObject(payload?.db)
    && hasText(payload.db.status)
    && hasNumber(payload.db.events)
    && hasNumber(payload.db.projects)
    && hasNumber(payload.db.sessions)
    && hasObject(payload?.spool)
    && (!Object.prototype.hasOwnProperty.call(payload.spool, 'status') || payload.spool.status === null || hasText(payload.spool.status))
    && (!Object.prototype.hasOwnProperty.call(payload.spool, 'error_code') || payload.spool.error_code === null || hasText(payload.spool.error_code))
    && (!Object.prototype.hasOwnProperty.call(payload.spool, 'error_message') || payload.spool.error_message === null || hasText(payload.spool.error_message))
    && hasNumber(payload.spool.ready)
    && hasNumber(payload.spool.processing)
    && hasNumber(payload.spool.quarantine)
    && hasNumber(payload.spool.ready_bytes)
    && hasNumber(payload.spool.processing_bytes)
    && hasNumber(payload.spool.quarantine_bytes)
    && (
      !Object.prototype.hasOwnProperty.call(payload.spool, 'terminal_finalizer_markers')
      || hasNumber(payload.spool.terminal_finalizer_markers)
    )
    && (
      !Object.prototype.hasOwnProperty.call(payload.spool, 'last_successful_flush_at')
      || payload.spool.last_successful_flush_at === null
      || hasText(payload.spool.last_successful_flush_at)
    )
    && (
      !Object.prototype.hasOwnProperty.call(payload.spool, 'last_successful_flush_age_seconds')
      || payload.spool.last_successful_flush_age_seconds === null
      || hasNumber(payload.spool.last_successful_flush_age_seconds)
    )
    && hasNumber(payload.spool.oldest_backlog_age_seconds)
    && hasNumber(payload.spool.oldest_ready_age_seconds)
    && hasNumber(payload.spool.oldest_processing_age_seconds)
    && hasNumber(payload.spool.oldest_quarantine_age_seconds)
    && metadataCountsByStateValid
    && (
      !Object.prototype.hasOwnProperty.call(payload.db, 'latest_event_age_seconds')
      || payload.db.latest_event_age_seconds === null
      || hasNumber(payload.db.latest_event_age_seconds)
    )
    && (!Object.prototype.hasOwnProperty.call(payload.spool, 'state_dir_exists') || typeof payload.spool.state_dir_exists === 'boolean')
    && (
      !Object.prototype.hasOwnProperty.call(payload.spool, 'state_dir_kind')
      || (hasText(payload.spool.state_dir_kind) && VALID_STATE_DIR_KINDS.has(payload.spool.state_dir_kind))
    )
    && (
      !Object.prototype.hasOwnProperty.call(payload.spool, 'quarantine_meta_error_counts')
      || hasObject(payload.spool.quarantine_meta_error_counts)
    )
    && (
      !Object.prototype.hasOwnProperty.call(payload.spool, 'oldest_first_seen_age_seconds')
      || hasNumber(payload.spool.oldest_first_seen_age_seconds)
    )
    && hasNumber(payload.spool.last_attempted_age_seconds)
    && (
      payload.spool.last_attempted_state === null
      || (hasText(payload.spool.last_attempted_state) && ['ready', 'processing', 'quarantine'].includes(payload.spool.last_attempted_state))
    )
    && (
      !Object.prototype.hasOwnProperty.call(payload.spool, 'max_attempt_count')
      || hasNumber(payload.spool.max_attempt_count)
    )
    && (
      !Object.prototype.hasOwnProperty.call(payload.spool, 'quarantine_source_state_counts')
      || hasObject(payload.spool.quarantine_source_state_counts)
    )
    && (
      !Object.prototype.hasOwnProperty.call(payload.spool, 'backlog_mode')
      || (hasText(payload.spool.backlog_mode) && VALID_BACKLOG_MODES.has(payload.spool.backlog_mode))
    )
  ) {
    return payload
  }

  throw createInvalidSummaryPayloadError(
    'Invalid status payload.',
    'Check that /api/v1/status returns api, db, and spool objects.',
  )
}

function validateUsageReportPayload(payload, path = '/api/v1/reports/daily') {
  if (
    !hasObject(payload)
    || !hasObject(payload.range)
    || !hasText(payload.range.type)
    || !hasObject(payload.totals)
    || !Array.isArray(payload.rows)
  ) {
    throw createInvalidSummaryPayloadError(
      'Invalid usage report payload.',
      `Check that ${path} returns range, totals, and rows.`,
    )
  }

  const requiredTotals = ['totalTokens', 'costUSD', 'activeSeconds', 'waitSeconds', 'sessions']
  if (!requiredTotals.every((fieldName) => hasNumber(payload.totals[fieldName]))) {
    throw createInvalidSummaryPayloadError(
      'Invalid usage report payload.',
      `Check that ${path} totals include token, cost, time, and session fields.`,
    )
  }

  return payload
}

function validateProvidersPayload(payload) {
  if (!hasObject(payload) || !Array.isArray(payload.providers)) {
    throw createInvalidSummaryPayloadError(
      'Invalid providers payload.',
      'Check that /api/v1/providers returns a providers array.',
    )
  }

  payload.providers.forEach((provider, index) => {
    if (
      !hasObject(provider)
      || !hasText(provider.id)
      || !hasText(provider.label)
      || !hasText(provider.status)
      || typeof provider.configured !== 'boolean'
      || typeof provider.polling !== 'boolean'
      || !hasNumber(provider.tokensToday)
      || !hasNumber(provider.costTodayUSD)
    ) {
      throw createInvalidSummaryPayloadError(
        'Invalid providers payload.',
        `Check that /api/v1/providers item ${index} includes safe provider summary fields.`,
      )
    }
  })

  return payload
}

function validateMenubarPreferencesPayload(payload) {
  const validViews = new Set(['minimal', 'standard', 'detailed'])
  const validStatusDisplays = new Set(['iconOnly', 'todayTokens', 'todayCost', 'topRiskPercent', 'alertCount'])
  const validThemes = new Set(['system', 'light', 'dark'])

  if (
    !hasObject(payload)
    || payload.version !== 2
    || typeof payload.enabled !== 'boolean'
    || !hasNumber(payload.refreshSeconds)
    || !validViews.has(payload.defaultView)
    || !validStatusDisplays.has(payload.statusDisplay)
    || !Array.isArray(payload.visibleMetrics)
    || !payload.visibleMetrics.every((metric) => hasText(metric))
    || !Array.isArray(payload.visibleProviders)
    || !payload.visibleProviders.every((provider) => hasText(provider))
    || !Array.isArray(payload.providerOrder)
    || !payload.providerOrder.every((provider) => hasText(provider))
    || !hasObject(payload.thresholds)
    || !hasNumber(payload.thresholds.warningPercent)
    || !hasNumber(payload.thresholds.criticalPercent)
    || !validThemes.has(payload.theme)
  ) {
    throw createInvalidSummaryPayloadError(
      'Invalid menubar preferences payload.',
      'Check that /api/v1/menubar/preferences returns the P0 menubar preferences v2 shape.',
    )
  }

  return payload
}

function isInvalidPayloadError(error) {
  return error?.code === 'invalid_summary_payload' || error?.code === 'invalid_json_response'
}

function getSummaryErrorText(error, invalidText, defaultText) {
  const protectedText = getProtectedDashboardErrorText(error)
  if (protectedText) {
    return protectedText
  }

  return isInvalidPayloadError(error) ? invalidText : defaultText
}

function buildUsageReportLines(report) {
  const totals = report?.totals ?? {}
  const rows = Array.isArray(report?.rows) ? report.rows : []
  const firstRow = rows[0] ?? null
  const locale = getCurrentLocale()
  const rowLabel = firstRow?.date
    ?? firstRow?.weekStart
    ?? firstRow?.month
    ?? firstRow?.sessionId
    ?? firstRow?.blockStart
    ?? (locale === 'en' ? 'No report rows yet' : t('message.noReportRowsYet'))

  if (locale === 'en') {
    return [
      `${formatNumber(totals.totalTokens ?? 0)} tokens today`,
      `$${Number(totals.costUSD ?? 0).toFixed(2)} cost estimate`,
      `${formatDuration(totals.activeSeconds ?? 0)} active / ${formatDuration(totals.waitSeconds ?? 0)} wait`,
      `${rows.length} rows · latest ${rowLabel}`,
    ]
  }

  return [
    `${t('report.tokensToday')}: ${formatNumber(totals.totalTokens ?? 0)}`,
    `${t('report.costEstimate')}: $${Number(totals.costUSD ?? 0).toFixed(2)}`,
    `${t('report.activeWait')}: ${formatDuration(totals.activeSeconds ?? 0)} / ${formatDuration(totals.waitSeconds ?? 0)}`,
    `${t('report.rowsLatest')}: ${rows.length} / ${rowLabel}`,
  ]
}

function buildProviderLines(payload) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : []
  if (!providers.length) {
    return ['No provider summaries yet. Usage events will populate local provider cards.']
  }

  return providers.slice(0, 4).map((provider) => {
    const status = provider.configured ? translateText(provider.status) : t('provider.notObserved')
    return `${provider.label}: ${formatNumber(provider.tokensToday ?? 0)} tok · $${Number(provider.costTodayUSD ?? 0).toFixed(2)} · ${status}`
  })
}

function buildSettingsLines(preferences) {
  const locale = getCurrentLocale()
  const enabledText = preferences?.enabled ? t('settings.enabled') : t('settings.disabled')
  const visibleMetrics = Array.isArray(preferences?.visibleMetrics)
    ? preferences.visibleMetrics.map((metric) => formatVisibleMetric(metric, locale)).join(', ')
    : ['tokens', 'costUSD', 'activeSeconds', 'topRisk'].map((metric) => formatVisibleMetric(metric, locale)).join(', ')
  const visibleProviders = Array.isArray(preferences?.visibleProviders)
    ? preferences.visibleProviders.join(', ')
    : 'codex, claude-code, gemini-cli, opencode'
  return [
    `${t('settings.menubar')}: ${enabledText} · ${formatMenubarView(preferences?.defaultView ?? 'standard', locale)} ${t('settings.view')}`,
    `${t('settings.refresh')}: ${preferences?.refreshSeconds ?? 60}s`,
    `${t('settings.statusDisplay')}: ${formatStatusDisplay(preferences?.statusDisplay ?? 'iconOnly', locale)}`,
    `${t('settings.visibleMetrics')}: ${visibleMetrics}`,
    `${t('settings.visibleProviders')}: ${visibleProviders}`,
    `${t('settings.theme')}: ${formatTheme(preferences?.theme ?? 'system', locale)}`,
    t('settings.pwaCache'),
  ]
}

function formatMenubarView(value, locale) {
  if (locale !== 'zh-CN' && locale !== 'zh-TW') {
    return value
  }

  return {
    minimal: locale === 'zh-TW' ? '極簡' : '极简',
    standard: locale === 'zh-TW' ? '標準' : '标准',
    detailed: locale === 'zh-TW' ? '詳細' : '详细',
  }[value] ?? value
}

function formatStatusDisplay(value, locale) {
  if (locale !== 'zh-CN' && locale !== 'zh-TW') {
    return value
  }

  const traditional = locale === 'zh-TW'
  return {
    iconOnly: traditional ? '僅圖示' : '仅图标',
    todayTokens: traditional ? '今日 Token' : '今日 Token',
    todayCost: traditional ? '今日費用' : '今日费用',
    topRiskPercent: traditional ? '風險百分比' : '风险百分比',
    alertCount: traditional ? '提醒數' : '提醒数',
  }[value] ?? value
}

function formatTheme(value, locale) {
  if (locale !== 'zh-CN' && locale !== 'zh-TW') {
    return value
  }

  const traditional = locale === 'zh-TW'
  return {
    system: traditional ? '跟隨系統' : '跟随系统',
    light: traditional ? '淺色' : '浅色',
    dark: traditional ? '深色' : '深色',
  }[value] ?? value
}

function formatVisibleMetric(value, locale) {
  if (locale !== 'zh-CN' && locale !== 'zh-TW') {
    return value
  }

  return {
    tokens: 'Token',
    totalTokens: 'Token',
    costUSD: locale === 'zh-TW' ? '費用' : '费用',
    activeSeconds: locale === 'zh-TW' ? '活躍時間' : '活跃时间',
    waitSeconds: locale === 'zh-TW' ? '等待時間' : '等待时间',
    topRisk: locale === 'zh-TW' ? '最高風險' : '最高风险',
    providers: 'Provider',
  }[value] ?? value
}

function buildStaticRouteDetail(route, data) {
  if (route.view === 'reports') {
    const totals = data.reports?.totals ?? {}
    return {
      title: 'Usage reports',
      description: 'Daily reports are rendered from the private P0 usage report API.',
      entries: [
        ['API', '/api/v1/reports/daily'],
        ['Tokens today', `${formatNumber(totals.totalTokens ?? 0)} tokens`],
        ['Cost estimate', `$${Number(totals.costUSD ?? 0).toFixed(2)}`],
        ['Rows', `${Array.isArray(data.reports?.rows) ? data.reports.rows.length : 0}`],
      ],
    }
  }

  if (route.view === 'providers') {
    const providers = Array.isArray(data.providers?.providers) ? data.providers.providers : []
    const observed = providers.filter((provider) => provider?.configured).length
    return {
      title: 'Providers and quotas',
      description: 'Provider cards are local summaries in P0; real provider polling remains disabled.',
      entries: [
        ['API', '/api/v1/providers'],
        ['Provider summaries', `${providers.length}`],
        ['Observed locally', `${observed}`],
        ['Polling', 'disabled in P0'],
      ],
    }
  }

  if (route.view === 'settings') {
    return {
      title: 'Local settings',
      description: 'Menubar preferences and PWA install assets are exposed through private local surfaces.',
      entries: [
        ['Menubar API', '/api/v1/menubar/preferences'],
        ['Menubar view', `${data.settings?.defaultView ?? 'standard'}`],
        ['Refresh interval', `${data.settings?.refreshSeconds ?? 60}s`],
        ['PWA cache', 'static shell assets only'],
      ],
    }
  }

  return null
}

function formatNumber(value) {
  return new Intl.NumberFormat(getCurrentLocale()).format(Number(value) || 0)
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(Number(seconds) || 0, 0)
  const minutes = Math.floor(safeSeconds / 60)
  const locale = getCurrentLocale()
  const isChinese = locale === 'zh-CN' || locale === 'zh-TW'
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    if (isChinese) {
      return `${hours}小时 ${minutes % 60}分`
    }
    return `${hours}h ${minutes % 60}m`
  }
  if (isChinese) {
    return `${minutes}分`
  }
  return `${minutes}m`
}

function isInvalidListError(error) {
  return error?.code === 'invalid_list_payload' || error?.code === 'invalid_json_response'
}

function getSessionListErrorText(error, invalidText, defaultText) {
  const protectedText = getProtectedDashboardErrorText(error)
  if (protectedText) {
    return protectedText
  }

  return isInvalidListError(error) ? invalidText : defaultText
}

function buildDataSnapshot(results) {
  const [
    overview,
    languages,
    models,
    hosts,
    projects,
    sessions,
    timeseries,
    status,
    reports,
    providers,
    settings,
  ] = results

  return {
    overview: getSettledValue(overview),
    languages: normalizeItemsPayload(getSettledValue(languages)),
    models: normalizeItemsPayload(getSettledValue(models)),
    hosts: normalizeItemsPayload(getSettledValue(hosts)),
    projects: normalizeItemsPayload(getSettledValue(projects)),
    sessions: normalizeItemsPayload(getSettledValue(sessions)),
    timeseries: normalizeItemsPayload(getSettledValue(timeseries)),
    status: getSettledValue(status),
    reports: getSettledValue(reports),
    providers: getSettledValue(providers),
    settings: getSettledValue(settings),
    loadState: {
      overview: overview.status,
      languages: languages.status,
      models: models.status,
      hosts: hosts.status,
      projects: projects.status,
      sessions: sessions.status,
      timeseries: timeseries.status,
      status: status.status,
      reports: reports.status,
      providers: providers.status,
      settings: settings.status,
    },
    errors: {
      overview: getSettledError(overview),
      languages: getSettledError(languages),
      models: getSettledError(models),
      hosts: getSettledError(hosts),
      projects: getSettledError(projects),
      sessions: getSettledError(sessions),
      timeseries: getSettledError(timeseries),
      status: getSettledError(status),
      reports: getSettledError(reports),
      providers: getSettledError(providers),
      settings: getSettledError(settings),
    },
  }
}

function getActiveHref(route) {
  if (route.view === 'project') {
    return buildProjectHash(route.projectRef)
  }

  if (route.view === 'session') {
    return buildSessionHash(route.sessionId, route.projectRef)
  }

  if (route.view === 'reports') {
    return buildReportsHash()
  }

  if (route.view === 'providers') {
    return buildProvidersHash()
  }

  if (route.view === 'settings') {
    return buildSettingsHash()
  }

  return buildHomeHash()
}

function getViewCopy(route) {
  if (route.view === 'reports') {
    return {
      title: 'Usage reports',
      description: 'Inspect daily token, cost, time, session, and block summaries from the private API.',
    }
  }

  if (route.view === 'providers') {
    return {
      title: 'Providers and quotas',
      description: 'Review local provider summaries and the P0 quota contract without reading provider credentials.',
    }
  }

  if (route.view === 'settings') {
    return {
      title: 'Local settings',
      description: 'Manage install, PWA, menubar, and privacy-oriented local settings surfaces.',
    }
  }

  if (route.view === 'project') {
    return {
      title: 'Project overview',
      description: 'Inspect project-level rollups and recent sessions from the latest snapshot.',
    }
  }

  if (route.view === 'session') {
    return {
      title: 'Session overview',
      description: 'Inspect one logical session and its surrounding snapshot context.',
    }
  }

  return {
    title: 'Home overview',
    description: 'Clipulse keeps this dashboard local-first, compact, and readable for daily checks. Metrics are summary-first heuristics meant for quick inspection.',
  }
}

function buildDetailFallback(route, loadState, detailState, summaryErrors = {}) {
  if (detailState?.staticDetail) {
    return detailState.staticDetail
  }

  const detailStatus = route.view === 'project'
    ? detailState?.projectDetailStatus ?? detailState?.status
    : detailState?.status
  const detailError = route.view === 'project'
    ? detailState?.projectDetailError ?? detailState?.error
    : detailState?.error

  if ((route.view === 'project' || route.view === 'session') && detailStatus === 'idle') {
    return {
      title: route.view === 'project' ? 'Project detail loading' : 'Session detail loading',
      description: 'Clipulse is preparing the detail view for this route.',
      entries: [['Status', 'Loading detail data...']],
    }
  }

  if ((route.view === 'project' || route.view === 'session') && detailStatus === 'loading') {
    return {
      title: route.view === 'project' ? 'Project detail loading' : 'Session detail loading',
      description: 'Clipulse is loading the latest detail payload for this view.',
      entries: [['Status', 'Loading detail data...']],
    }
  }

  if ((route.view === 'project' || route.view === 'session') && detailStatus === 'error') {
    const detailLabel = detailError?.status === 0
      ? 'Network request failed before an HTTP status was returned.'
      : detailError?.detail ?? 'Unable to load detail data yet.'
    const hintLabel = detailError?.hint ?? 'Check /healthz, CLIPULSE_API_URL, /api/v1/status if the API still responds, and CLIPULSE_STATE_DIR/spool/ready.'
    const description = detailError?.status === 0
      ? 'The dedicated detail request failed before the API returned an HTTP status. Check /healthz, CLIPULSE_API_URL, and local network reachability.'
      : detailError?.code
      ? `The dedicated detail endpoint returned ${detailError.code}. Check /healthz, CLIPULSE_API_URL, /api/v1/status if the API still responds, and local backlog state.`
      : 'The dedicated detail endpoint could not be loaded. Check /healthz, CLIPULSE_API_URL, /api/v1/status if the API still responds, and whether backlog batches are still waiting in CLIPULSE_STATE_DIR/spool/ready.'
    if (route.view === 'session' && detailError?.code === 'ambiguous_session') {
      return {
        title: 'Session detail needs project scope',
        description: 'This session id matched more than one project. Open the project-scoped session link or retry with the matching project_ref.',
        entries: [
          ['Status', detailLabel],
          ['Hint', hintLabel],
        ],
      }
    }
    if (route.view === 'session' && detailError?.code === 'session_not_found') {
      return {
        title: 'Session not found',
        description: 'This session is no longer available for the selected project scope. Open the project view and choose it again from the latest list.',
        entries: [
          ['Status', detailLabel],
          ['Hint', hintLabel],
        ],
      }
    }
    if (route.view === 'project' && detailError?.code === 'project_not_found') {
      return {
        title: 'Project not found',
        description: 'This project is no longer available in the latest dashboard snapshot. Reopen the home view and pick it again.',
        entries: [
          ['Status', detailLabel],
          ['Hint', hintLabel],
        ],
      }
    }
    if (detailError?.code === 'invalid_json_response' || detailError?.code === 'invalid_detail_payload') {
      return {
        title: route.view === 'project' ? 'Project detail unavailable' : 'Session detail unavailable',
        description: 'The dedicated detail endpoint returned an invalid detail payload. This usually means mixed-version/contract-drift between the API and dashboard contracts. Check that the API still returns the expected JSON shape for this route.',
        entries: [
          ['Status', detailLabel],
          ['Hint', hintLabel],
        ],
      }
    }
    return {
      title: route.view === 'project' ? 'Project detail unavailable' : 'Session detail unavailable',
      description,
      entries: [
        ['Status', detailLabel],
        ['Hint', hintLabel],
      ],
    }
  }

  if (route.view === 'home' && loadState.overview !== 'fulfilled') {
    const overviewError = summaryErrors?.overview
    if (isInvalidPayloadError(overviewError)) {
      return {
        title: 'Home overview unavailable',
        description: 'The overview feed returned an invalid overview payload. Check that /api/v1/overview still returns the expected JSON shape.',
        entries: [['Status', overviewError?.detail ?? 'Invalid overview payload.']],
      }
    }

    return {
      title: 'Home overview unavailable',
      description: 'The overview feed is not available. Check /healthz, then inspect /api/v1/status if the API still responds, and confirm the API can read the current SQLite database.',
      entries: [['Status', 'Unable to load overview yet. Check /healthz, CLIPULSE_API_URL, and /api/v1/status if the API still responds.']],
    }
  }

  return null
}

function getDetailStatus(detailState, route) {
  return route.view === 'project'
    ? detailState?.projectDetailStatus ?? detailState?.status
    : detailState?.status
}

function getDetailError(detailState, route) {
  return route.view === 'project'
    ? detailState?.projectDetailError ?? detailState?.error
    : detailState?.error
}

function formatDetailErrorStatus(detailError) {
  return detailError?.status === 0
    ? 'Network request failed before an HTTP status was returned.'
    : detailError?.detail ?? 'Unable to load detail data yet.'
}

function formatDetailErrorHint(detailError) {
  return detailError?.hint ?? 'Check /healthz, CLIPULSE_API_URL, /api/v1/status if the API still responds, and CLIPULSE_STATE_DIR/spool/ready.'
}

function supportsSummaryBackedDetail(detailError) {
  if (!detailError) {
    return false
  }

  if (detailError.status === 0 || detailError.status >= 500) {
    return true
  }

  return typeof detailError.code === 'string' && detailError.code.endsWith('_unavailable')
}

function normalizeProjectSummaryForDetail(summary, routeProjectRef) {
  if (!summary || typeof summary !== 'object') {
    return null
  }

  const observedHost = summary.host ?? summary.host_model_primary?.host ?? null
  const observedModelName = summary.model_name ?? summary.host_model_primary?.model_name ?? null
  const observedBranch = summary.git_branch ?? null

  return {
    project_name: summary.project_name,
    project_ref: summary.project_ref ?? routeProjectRef,
    host: observedHost,
    model_name: observedModelName,
    git_branch: observedBranch,
    active_ms: summary.active_ms ?? 0,
    wait_ms: summary.wait_ms ?? 0,
    event_count: summary.event_count ?? summary.events ?? 0,
    session_count: Number.isFinite(summary.session_count) ? summary.session_count : null,
    changed_files_count: summary.changed_files_count ?? 0,
    changed_languages_count: summary.changed_languages_count ?? (summary.top_language ? 1 : 0),
    lines_added: summary.lines_added ?? 0,
    lines_removed: summary.lines_removed ?? 0,
    lines_changed: summary.lines_changed ?? 0,
    top_language: summary.top_language ?? null,
    file_preview: Array.isArray(summary.file_preview) ? summary.file_preview : [],
    languages: Array.isArray(summary.languages) ? summary.languages : [],
    host_model_primary: summary.host_model_primary ?? null,
    host_model_mix: Array.isArray(summary.host_model_mix) ? summary.host_model_mix : [],
    host_model_mix_count: summary.host_model_mix_count ?? summary.host_model_mix?.length ?? (summary.host_model_primary ? 1 : 0),
    last_event_time: summary.last_event_time ?? null,
    last_host: summary.last_host ?? null,
    last_model_name: summary.last_model_name ?? null,
    last_git_branch: summary.last_git_branch ?? null,
  }
}

function normalizeSessionSummaryForDetail(summary, route) {
  if (!summary || typeof summary !== 'object') {
    return null
  }

  return {
    session_id: summary.session_id ?? route.sessionId,
    project_name: summary.project_name ?? summary.project_ref ?? route.projectRef ?? null,
    project_ref: summary.project_ref ?? route.projectRef ?? null,
    host: summary.host ?? summary.last_host ?? summary.host_model_primary?.host ?? null,
    last_host: summary.last_host ?? null,
    model_name: summary.model_name ?? summary.last_model_name ?? summary.host_model_primary?.model_name ?? null,
    last_model_name: summary.last_model_name ?? null,
    git_branch: summary.git_branch ?? summary.last_git_branch ?? null,
    last_git_branch: summary.last_git_branch ?? null,
    first_event_time: summary.first_event_time ?? null,
    last_event_time: summary.last_event_time ?? null,
    event_count: summary.event_count ?? summary.events ?? 0,
    active_ms: summary.active_ms ?? 0,
    wait_ms: summary.wait_ms ?? 0,
    changed_files_count: summary.changed_files_count ?? 0,
    changed_languages_count: summary.changed_languages_count ?? (summary.top_language ? 1 : 0),
    lines_added: summary.lines_added ?? 0,
    lines_removed: summary.lines_removed ?? 0,
    lines_changed: summary.lines_changed ?? 0,
    top_language: summary.top_language ?? null,
    languages: Array.isArray(summary.languages) ? summary.languages : [],
    file_deltas: Array.isArray(summary.file_deltas) ? summary.file_deltas : [],
    file_preview: Array.isArray(summary.file_preview) ? summary.file_preview : [],
    host_model_primary: summary.host_model_primary ?? null,
    host_model_mix: Array.isArray(summary.host_model_mix) ? summary.host_model_mix : [],
    host_model_mix_count: summary.host_model_mix_count ?? summary.host_model_mix?.length ?? (summary.host_model_primary ? 1 : 0),
  }
}

function buildSummaryBackedDetailState(route, data) {
  const detailStatus = getDetailStatus(data.detail, route)
  const detailError = getDetailError(data.detail, route)

  if ((route.view !== 'project' && route.view !== 'session') || detailStatus !== 'error' || !supportsSummaryBackedDetail(detailError)) {
    return null
  }

  if (route.view === 'project') {
    const projectSummary = data.projects.items.find((item) => item?.project_ref === route.projectRef)
    const projectDetail = normalizeProjectSummaryForDetail(projectSummary, route.projectRef)
    if (!projectDetail) {
      return null
    }

    return {
      ...data.detail,
      projectDetail,
      projectDetailStatus: 'summary',
      error: null,
      status: 'ready',
      routeState: 'partial',
      completeness: 'summary-backed project detail while the dedicated project detail feed recovers.',
      statusMessage: formatDetailErrorStatus(detailError),
      hintMessage: formatDetailErrorHint(detailError),
      summaryBacked: true,
    }
  }

  const sessionSummary = data.sessions.items.find((item) => (
    item?.session_id === route.sessionId
    && (route.projectRef ? item?.project_ref === route.projectRef : true)
  ))
  const sessionDetail = normalizeSessionSummaryForDetail(sessionSummary, route)
  if (!sessionDetail) {
    return null
  }

  return {
    ...data.detail,
    sessionDetail,
    status: 'ready',
    error: null,
    routeState: 'partial',
    completeness: 'summary-backed session detail while the dedicated session detail feed recovers.',
    statusMessage: formatDetailErrorStatus(detailError),
    hintMessage: formatDetailErrorHint(detailError),
    summaryBacked: true,
  }
}

function getDashboardAuthError(data) {
  const candidateErrors = [
    data?.detail?.error,
    data?.detail?.projectDetailError,
    data?.detail?.projectSessionsError,
    data?.detail?.sessionRelatedSessionsError,
    data?.errors?.overview,
    data?.errors?.languages,
    data?.errors?.models,
    data?.errors?.hosts,
    data?.errors?.projects,
    data?.errors?.sessions,
    data?.errors?.timeseries,
    data?.errors?.status,
    data?.errors?.reports,
    data?.errors?.providers,
    data?.errors?.settings,
  ]

  return candidateErrors.find((error) => isAuthError(error)) ?? null
}

function getDashboardAuthPolicy(data) {
  return hasObject(data?.status?.auth) ? data.status.auth : null
}

function deriveAuthUiState(data, logoutState) {
  const authPolicy = getDashboardAuthPolicy(data)
  const authError = getDashboardAuthError(data)
  const statusMetadataUnavailable = !authPolicy
    && (data?.errors?.status?.code === 'invalid_summary_payload' || data?.errors?.status?.code === 'invalid_json_response')

  if (authError?.status === 401) {
    return {
      hidden: false,
      tone: 'warning',
      buttonLabel: 'Return to sign-in',
      buttonDisabled: false,
      message: 'Sign in required for this protected dashboard. Sign in again, then reload.',
      error: authError,
      signedOut: true,
      returnToSignIn: true,
    }
  }

  if (authError?.status === 403) {
    return {
      hidden: false,
      tone: 'warning',
      buttonLabel: 'Log out and switch account',
      buttonDisabled: false,
      message: 'Access blocked for the current account. Log out to switch accounts.',
      error: authError,
      signedOut: true,
      returnToSignIn: true,
      requiresLogoutBeforeSignIn: true,
    }
  }

  if (statusMetadataUnavailable) {
    return {
      hidden: false,
      tone: 'warning',
      buttonLabel: '',
      buttonDisabled: true,
      message: 'Dashboard auth status is unavailable. Check API/dashboard version compatibility.',
      authUnknown: true,
    }
  }

  if (!authPolicy || authPolicy.dashboard_auth_required === false || authPolicy.browser_session_enabled === false) {
    return {
      hidden: true,
      tone: 'neutral',
      buttonLabel: '',
      buttonDisabled: true,
      message: '',
    }
  }

  if (logoutState?.status === 'loading') {
    return {
      tone: 'progress',
      buttonLabel: 'Logging out...',
      buttonDisabled: true,
      message: 'Signing out of the protected dashboard...',
    }
  }

  if (logoutState?.status === 'error') {
    return {
      tone: 'error',
      buttonLabel: 'Log out',
      buttonDisabled: false,
      message: logoutState.message ?? 'Logout failed. Try again.',
    }
  }

  if (logoutState?.status === 'success') {
    return {
      tone: 'success',
      buttonLabel: 'Return to sign-in',
      buttonDisabled: false,
      message: logoutState.message ?? 'Logged out. Sign in again to reopen the protected dashboard.',
      signedOut: true,
      returnToSignIn: true,
    }
  }

  return {
    tone: 'neutral',
    buttonLabel: 'Log out',
    buttonDisabled: false,
    message: 'Protected dashboard session active.',
  }
}

function renderViewNav(doc, target, route) {
  if (!target) {
    return
  }

  const links = [
    { href: buildHomeHash(), label: t('nav.home') },
    { href: buildReportsHash(), label: t('nav.reports') },
    { href: buildProvidersHash(), label: t('nav.providers') },
    { href: buildSettingsHash(), label: t('nav.settings') },
  ]

  if (route.view === 'project') {
    links.push({ href: buildProjectHash(route.projectRef), label: t('nav.project') })
  } else if (route.view === 'session' && route.projectRef) {
    links.push({ href: buildProjectHash(route.projectRef), label: t('nav.project') })
    links.push({ href: buildSessionHash(route.sessionId, route.projectRef), label: t('nav.session') })
  } else if (route.view === 'session') {
    links.push({ href: buildSessionHash(route.sessionId), label: t('nav.session') })
  }

  const activeHref = getActiveHref(route)
  const nodes = links.map((item) => {
    const link = doc.createElement('a')
    link.className = 'view-link'
    if (item.href === activeHref) {
      link.className = 'view-link view-link-active'
      link.setAttribute('aria-current', 'page')
    }
    link.href = item.href
    link.textContent = item.label
    return link
  })

  target.replaceChildren(...nodes)
}

function updateAuthChrome(sections, authUiState) {
  if (sections.dashboardAuth) {
    sections.dashboardAuth.hidden = Boolean(authUiState.hidden)
  }

  if (sections.logoutButton) {
    sections.logoutButton.textContent = translateText(authUiState.buttonLabel)
    sections.logoutButton.disabled = authUiState.buttonDisabled
  }

  renderSectionTitle(sections.authStatus, translateText(authUiState.message))
}

function renderSignedOutDashboard(doc, sections) {
  renderMetricList(doc, sections.overview, [translateText('Sign in again to reload private dashboard data.')])
  renderMetricList(doc, sections.languages, [translateText('Sign in again to reload language data.')])
  renderMetricList(doc, sections.models, [translateText('Sign in again to reload model data.')])
  renderMetricList(doc, sections.hosts, [translateText('Sign in again to reload host data.')])
  renderLinkList(doc, sections.projects, [], null, translateText('Sign in again to load project data.'))
  renderLinkList(doc, sections.sessions, [], null, translateText('Sign in again to load recent sessions.'))
  renderMetricList(doc, sections.timeseries, [translateText('Sign in again to reload daily activity.')])
  renderMetricList(doc, sections.reports, [translateText('Sign in again to load usage reports.')])
  renderMetricList(doc, sections.providers, [translateText('Sign in again to load provider summaries.')])
  renderMetricList(doc, sections.settings, [translateText('Sign in again to load menubar settings.')])
}

function updateViewChrome(doc, sections, route, detail, authUiState) {
  const viewCopy = getViewCopy(route)
  renderViewNav(doc, sections.viewNav, route)
  updateAuthChrome(sections, authUiState)
  renderSectionTitle(sections.viewTitle, translateText(viewCopy.title))
  renderSectionTitle(sections.viewDescription, translateText(viewCopy.description))
  renderSectionTitle(sections.detailTitle, translateText(detail.title))
  renderSectionTitle(sections.detailDescription, translateText(detail.description))
}

function buildAuthDetailFallback(route, authUiState) {
  const authError = authUiState?.error
  if (!authError) {
    return null
  }

  if (authError.status === 401) {
    return {
      title: 'Dashboard sign-in required',
      description: 'This protected dashboard needs a valid signed-in session before the frontend can load dashboard data.',
      entries: [
        ['Status', authError.detail ?? 'Dashboard login required.'],
        ['Hint', authError.hint ?? 'Sign in to continue, then reload this dashboard.'],
      ],
    }
  }

  if (authError.status === 403) {
    return {
      title: 'Dashboard access blocked',
      description: 'The current signed-in account cannot open this protected dashboard. Log out and try another allowed account.',
      entries: [
        ['Status', authError.detail ?? 'Dashboard access is forbidden for this account.'],
        ['Hint', authError.hint ?? 'Log out and sign in with an allowed account.'],
      ],
    }
  }

  return null
}

function getRouteRelevantCompatSections(route) {
  if (route.view === 'project') {
    return ['projectDetail', 'sessionListItem']
  }

  if (route.view === 'session') {
    return ['sessionDetail', 'sessionListItem']
  }

  return [...DASHBOARD_COMPAT_SECTION_NAMES]
}

function getRelevantFallbackSections(route, compat) {
  const relevantSectionNames = new Set(getRouteRelevantCompatSections(route))
  return (compat?.fallbackSections ?? []).filter((sectionName) => relevantSectionNames.has(sectionName))
}

function getRouteDetailPayload(route, detailState) {
  if (route.view === 'project') {
    return detailState?.projectDetail ?? null
  }

  if (route.view === 'session') {
    return detailState?.sessionDetail ?? null
  }

  return null
}

function isExperimentalHost(host) {
  return typeof host === 'string' && ['gemini-cli', 'opencode'].includes(host.toLowerCase())
}

function getDetailHostReleases(detailPayload) {
  const hosts = new Set()

  for (const host of [
    detailPayload?.host_model_primary?.host,
    detailPayload?.host,
    detailPayload?.last_host,
    ...(Array.isArray(detailPayload?.host_model_mix) ? detailPayload.host_model_mix.map((item) => item?.host) : []),
  ]) {
    if (hasText(host)) {
      hosts.add(isExperimentalHost(host) ? 'experimental' : 'stable')
    }
  }

  return hosts
}

function appendUniqueText(target, value) {
  if (!hasText(value)) {
    return
  }

  const text = value.trim()
  if (!target.includes(text)) {
    target.push(text)
  }
}

function joinRouteMessages(messages) {
  return messages.length > 0 ? messages.join(' ') : null
}

function getSameProjectSiblingItems(items, projectRef, sessionId) {
  if (!hasText(projectRef)) {
    return []
  }

  return (Array.isArray(items) ? items : []).filter((item) => (
    item?.project_ref === projectRef
    && hasText(item?.session_id)
    && item.session_id !== sessionId
  ))
}

function buildRelatedFeedFallbackMessage(error, usingRecentFallback) {
  const detailText = hasText(error?.detail)
    ? error.detail
    : 'Project-scoped sibling feed is temporarily unavailable.'

  if (!usingRecentFallback) {
    return detailText
  }

  return `${detailText} Showing same-project matches from the global recent feed instead.`
}

function isCompatPendingRefresh(compat) {
  if (!compat || compat.mode !== 'built-in') {
    return false
  }

  if (typeof compat.source_kind === 'string' && compat.source_kind.toLowerCase() === 'pending_refresh') {
    return true
  }

  return typeof compat.source === 'string' && compat.source.toLowerCase().includes('pending')
}

function buildRouteStateDetailState(route, data, detailState) {
  if (route.view !== 'project' && route.view !== 'session') {
    return detailState
  }

  const detailPayload = getRouteDetailPayload(route, detailState)
  if (!detailPayload) {
    return detailState
  }

  const severities = []
  const completenessMessages = []
  const relatedFeedMessages = []

  appendUniqueText(severities, detailState?.routeState)
  appendUniqueText(completenessMessages, detailState?.completeness)
  appendUniqueText(relatedFeedMessages, detailState?.relatedFeed)

  if (route.view === 'project' && data.detail.projectSessionsStatus === 'error') {
    appendUniqueText(severities, 'partial')
    appendUniqueText(completenessMessages, 'project detail loaded, but project sessions coverage is still partial.')
    appendUniqueText(relatedFeedMessages, data.detail.projectSessionsError?.detail ?? 'Project sessions feed is temporarily unavailable.')
  }

  if (route.view === 'session') {
    const routeProjectRef = hasText(detailPayload?.project_ref) ? detailPayload.project_ref : route.projectRef
    const routeSessionId = hasText(detailPayload?.session_id) ? detailPayload.session_id : route.sessionId
    const recentFallbackItems = getSameProjectSiblingItems(data.sessions.items, routeProjectRef, routeSessionId)

    if (data.detail.sessionRelatedSessionsStatus === 'error') {
      appendUniqueText(severities, 'partial')
      appendUniqueText(completenessMessages, 'session detail loaded, but related sessions coverage is still partial.')
      appendUniqueText(
        relatedFeedMessages,
        buildRelatedFeedFallbackMessage(
          data.detail.sessionRelatedSessionsError,
          data.loadState.sessions === 'fulfilled',
        ),
      )
    } else if (!hasText(routeProjectRef) && data.loadState.sessions === 'rejected') {
      appendUniqueText(severities, 'partial')
      appendUniqueText(completenessMessages, 'session detail loaded, but recent sessions coverage is still partial.')
      appendUniqueText(relatedFeedMessages, data.errors?.sessions?.detail ?? 'Recent sessions feed is temporarily unavailable.')
    } else if (
      hasText(routeProjectRef)
      && data.detail.sessionRelatedSessionsStatus === 'idle'
      && data.loadState.sessions === 'rejected'
      && recentFallbackItems.length === 0
    ) {
      appendUniqueText(severities, 'partial')
      appendUniqueText(completenessMessages, 'session detail loaded, but related sessions coverage is still partial.')
      appendUniqueText(relatedFeedMessages, data.errors?.sessions?.detail ?? 'Recent sessions feed is temporarily unavailable.')
    }
  }

  const relevantFallbackSections = getRelevantFallbackSections(route, data.compat)
  if (relevantFallbackSections.length > 0 && !isCompatPendingRefresh(data.compat)) {
    appendUniqueText(severities, 'attention')
    appendUniqueText(
      completenessMessages,
      `Built-in compatibility fallback is active for ${summarizeFallbackSections(relevantFallbackSections)} on this route.`,
    )
  }

  if (data.compat?.source_kind === 'hash_drift') {
    appendUniqueText(severities, 'attention')
    appendUniqueText(
      completenessMessages,
      'Compatibility hash drift detected between /api/v1/status and the loaded dashboard contract.',
    )
  }

  const hostReleases = getDetailHostReleases(detailPayload)
  if (hostReleases.has('stable') && hostReleases.has('experimental')) {
    appendUniqueText(severities, 'attention')
    appendUniqueText(completenessMessages, 'This route mixes stable and experimental host data.')
  } else if (hostReleases.has('experimental')) {
    appendUniqueText(severities, 'attention')
    appendUniqueText(completenessMessages, 'This route includes experimental host data.')
  }

  const routeState = severities.includes('attention')
    ? 'attention'
    : severities.includes('partial')
      ? 'partial'
      : null

  return {
    ...detailState,
    routeState,
    completeness: joinRouteMessages(completenessMessages),
    relatedFeed: joinRouteMessages(relatedFeedMessages),
  }
}

function summarizeRouteCompatibility(route, compat, relevantFallbackSections) {
  if (route.view === 'home') {
    return formatCompatibilitySummary(compat)
  }

  if (compat?.mode === 'mixed' && compat.usingFallback && relevantFallbackSections.length === 0) {
    const metaText = hasText(compat.metaLabel) ? ` via ${compat.metaLabel}` : ''
    return `Remote contract active${metaText}, with built-in fallback elsewhere in dashboard.`
  }

  return formatCompatibilitySummary({
    ...compat,
    fallbackSectionsLabel: relevantFallbackSections.length > 0
      ? summarizeFallbackSections(relevantFallbackSections)
      : null,
  })
}

function isDetailErrorState(route, detail) {
  if (route.view === 'home' || !hasText(detail?.title)) {
    return false
  }

  return [
    'Project detail unavailable',
    'Session detail unavailable',
    'Project not found',
    'Session not found',
    'Session detail needs project scope',
  ].includes(detail.title)
}

function shouldExpandCompatDetails(route, compat, detail, relevantFallbackSections) {
  if (route.view === 'home') {
    return true
  }

  if (isDetailErrorState(route, detail)) {
    return true
  }

  if (compat?.mode === 'built-in') {
    return true
  }

  return compat?.source_kind === 'hash_drift' || relevantFallbackSections.length > 0
}

function withCompatFallbackHint(detail, compat, route) {
  if (!Array.isArray(detail?.entries) || !hasText(compat?.mode)) {
    return detail
  }

  const nextEntries = [...detail.entries]
  const relevantSectionNames = new Set(getRouteRelevantCompatSections(route))
  const relevantFallbackSections = (compat.fallbackSections ?? []).filter((sectionName) => relevantSectionNames.has(sectionName))
  const relevantFallbackFieldDiagnostics = (compat.fallbackFieldDiagnostics ?? [])
    .filter((item) => relevantSectionNames.has(item.sectionName))
  const unrelatedFallbackSections = (compat.fallbackSections ?? []).filter((sectionName) => !relevantSectionNames.has(sectionName))
  const compatibilitySummary = summarizeRouteCompatibility(route, compat, relevantFallbackSections)
  const shouldExpandDetails = shouldExpandCompatDetails(route, compat, detail, relevantFallbackSections)

  if (
    route.view !== 'home'
    && hasText(compatibilitySummary)
    && !nextEntries.some((entry) => entry?.[0] === 'Compatibility')
  ) {
    nextEntries.push(['Compatibility', compatibilitySummary])
  }

  if (route.view !== 'home') {
    if (!shouldExpandDetails) {
      return {
        ...detail,
        entries: nextEntries,
      }
    }

    if (
      unrelatedFallbackSections.length > 0
      && !nextEntries.some((entry) => entry?.[0] === 'Compatibility scope')
    ) {
      nextEntries.push(['Compatibility scope', 'Fallback active elsewhere in dashboard.'])
    }

    if (
      relevantFallbackSections.length > 0
      && !nextEntries.some((entry) => entry?.[0] === 'Fallback sections')
    ) {
      nextEntries.push(['Fallback sections', summarizeFallbackSections(relevantFallbackSections)])
    }

    const affectedFieldsLabel = summarizeAffectedFieldDiagnostics(relevantFallbackFieldDiagnostics)
    if (affectedFieldsLabel && !nextEntries.some((entry) => entry?.[0] === 'Affected fields')) {
      nextEntries.push(['Affected fields', affectedFieldsLabel])
    }

    if (hasText(compat.source) && !nextEntries.some((entry) => entry?.[0] === 'Compatibility source')) {
      nextEntries.push(['Compatibility source', compat.source])
    }

    if (hasText(compat.metaLabel) && !nextEntries.some((entry) => entry?.[0] === 'Contract meta')) {
      nextEntries.push(['Contract meta', compat.metaLabel])
    }

    return {
      ...detail,
      entries: nextEntries,
    }
  }

  if (!nextEntries.some((entry) => entry?.[0] === 'Compatibility mode')) {
    nextEntries.push(['Compatibility mode', compat.mode])
  }

  if (hasText(compat.source) && !nextEntries.some((entry) => entry?.[0] === 'Compatibility source')) {
    nextEntries.push(['Compatibility source', compat.source])
  }

  if (
    compat.usingFallback
    && hasText(compat.fallbackSectionsLabel)
    && !nextEntries.some((entry) => entry?.[0] === 'Fallback sections')
  ) {
    nextEntries.push(['Fallback sections', compat.fallbackSectionsLabel])
  }

  if (hasText(compat.metaLabel) && !nextEntries.some((entry) => entry?.[0] === 'Contract meta')) {
    nextEntries.push(['Contract meta', compat.metaLabel])
  }

  return {
    ...detail,
    entries: nextEntries,
  }
}

function renderDashboard(doc, sections, route, data, authUiState) {
  const activeHref = getActiveHref(route)
  const sessionScope = getSessionScope(route, data)
  renderSectionTitle(sections.sessionsTitle, translateText(sessionScope.title))

  if (authUiState?.signedOut) {
    renderSignedOutDashboard(doc, sections)
    const signedOutDetail = buildAuthDetailFallback(route, authUiState) ?? {
      title: 'Dashboard signed out',
      description: 'Private dashboard data was cleared from this page after logout.',
      entries: [
        ['Status', 'Signed out successfully.'],
        ['Hint', 'Sign in again to load private dashboard data.'],
      ],
    }
    const translatedSignedOutDetail = {
      ...signedOutDetail,
      title: translateText(signedOutDetail.title),
      description: translateText(signedOutDetail.description),
      entries: signedOutDetail.entries.map(([label, value]) => [translateText(label), translateText(value)]),
    }
    updateViewChrome(doc, sections, route, translatedSignedOutDetail, authUiState)
    renderDetailPanel(doc, sections.detailPanel ?? sections.detail, translatedSignedOutDetail)
    return
  }

  renderMetricList(
    doc,
    sections.overview,
    buildSummaryLines(
      data.loadState.overview,
      data.overview ? buildOverviewLines(data.overview, { locale: getCurrentLocale() }) : null,
      'Loading overview...',
      getSummaryErrorText(data.errors?.overview, 'Invalid overview payload.', 'Unable to load overview yet.'),
    ).map((line) => translateText(line)),
  )
  renderMetricList(
    doc,
    sections.languages,
    buildSummaryLines(
      data.loadState.languages,
      data.languages ? buildLanguageLines(data.languages.items) : null,
      'Loading language data...',
      getSummaryErrorText(data.errors?.languages, 'Invalid language payload.', 'Unable to load language data yet.'),
    ).map((line) => translateText(line)),
  )
  renderMetricList(
    doc,
    sections.models,
    buildSummaryLines(
      data.loadState.models,
      data.models ? buildModelLines(data.models.items, { locale: getCurrentLocale() }) : null,
      'Loading model data...',
      getSummaryErrorText(data.errors?.models, 'Invalid model payload.', 'Unable to load model data yet.'),
    ).map((line) => translateText(line)),
  )
  renderMetricList(
    doc,
    sections.hosts,
    buildSummaryLines(
      data.loadState.hosts,
      data.hosts ? buildHostLines(data.hosts.items, { locale: getCurrentLocale() }) : null,
      'Loading host data...',
      getSummaryErrorText(data.errors?.hosts, 'Invalid host payload.', 'Unable to load host data yet.'),
    ).map((line) => translateText(line)),
  )

  renderLinkList(
    doc,
    sections.projects,
    buildProjectListItems(data.projects.items, { locale: getCurrentLocale() }).map((item) => ({
      ...item,
      label: translateText(item.label),
      meta: translateText(item.meta),
    })),
    activeHref,
    translateText(buildEmptyStateText(
      data.loadState.projects,
      'Loading project data...',
      'No project data yet.',
      getSummaryErrorText(data.errors?.projects, 'Invalid project payload.', 'Unable to load project data yet.'),
    )),
  )
  renderLinkList(
    doc,
    sections.sessions,
    buildRecentSessionItems(sessionScope.items, { locale: getCurrentLocale() }).map((item) => ({
      ...item,
      label: translateText(item.label),
      meta: translateText(item.meta),
    })),
    activeHref,
    translateText(buildEmptyStateText(
      sessionScope.loadState,
      sessionScope.loadingText,
      sessionScope.emptyText,
      sessionScope.errorText,
    )),
  )

  if (data.loadState.timeseries === 'fulfilled') {
    renderTimeseries(
      doc,
      sections.timeseries,
      buildTimeseriesRows(data.timeseries.items, { locale: getCurrentLocale() }).map((row) => ({
        ...row,
        dateLabel: translateText(row.dateLabel),
        summary: translateText(row.summary),
      })),
      translateText('No daily activity yet.'),
    )
  } else if (data.loadState.timeseries === 'pending') {
    renderMetricList(doc, sections.timeseries, [translateText('Loading daily activity...')])
  } else {
    renderMetricList(
      doc,
      sections.timeseries,
      [translateText(getSummaryErrorText(data.errors?.timeseries, 'Invalid daily activity payload.', 'Unable to load daily activity yet.'))],
    )
  }

  renderMetricList(
    doc,
    sections.reports,
    buildSummaryLines(
      data.loadState.reports,
      data.reports ? buildUsageReportLines(data.reports) : null,
      'Loading usage reports...',
      getSummaryErrorText(data.errors?.reports, 'Invalid usage report payload.', 'Unable to load usage reports yet.'),
    ).map((line) => translateText(line)),
  )
  renderMetricList(
    doc,
    sections.providers,
    buildSummaryLines(
      data.loadState.providers,
      data.providers ? buildProviderLines(data.providers) : null,
      'Loading provider summaries...',
      getSummaryErrorText(data.errors?.providers, 'Invalid providers payload.', 'Unable to load provider summaries yet.'),
    ).map((line) => translateText(line)),
  )
  renderMetricList(
    doc,
    sections.settings,
    buildSummaryLines(
      data.loadState.settings,
      data.settings ? buildSettingsLines(data.settings) : null,
      'Loading menubar settings...',
      getSummaryErrorText(data.errors?.settings, 'Invalid menubar preferences payload.', 'Unable to load menubar settings yet.'),
    ).map((line) => translateText(line)),
  )

  const detailState = buildRouteStateDetailState(
    route,
    data,
    buildSummaryBackedDetailState(route, data) ?? data.detail,
  )
  const detail = withCompatFallbackHint(
    buildAuthDetailFallback(route, authUiState)
      ?? buildDetailFallback(route, data.loadState, detailState, data.errors)
      ?? buildDetailEntries(route, data, detailState, { locale: getCurrentLocale() }),
    data.compat,
    route,
  )
  const translatedDetail = {
    ...detail,
    title: translateText(detail.title),
    description: translateText(detail.description),
    entries: detail.entries.map(([label, value]) => [translateText(label), translateText(value)]),
  }
  updateViewChrome(doc, sections, route, translatedDetail, authUiState)
  renderDetailPanel(doc, sections.detailPanel ?? sections.detail, translatedDetail)
}

function buildSummaryLines(loadState, successLines, pendingText, errorText) {
  if (loadState === 'pending') {
    return [pendingText]
  }

  if (loadState === 'fulfilled') {
    return successLines ?? [errorText]
  }

  return [errorText]
}

function buildEmptyStateText(loadState, pendingText, emptyText, errorText) {
  if (loadState === 'pending') {
    return pendingText
  }

  if (loadState === 'fulfilled') {
    return emptyText
  }

  return errorText
}

function buildRelatedSessionsErrorText(error) {
  if (isInvalidListError(error)) {
    const detail = error?.detail ?? 'Related sessions did not match the expected payload shape.'
    const hint = error?.hint ?? 'Check the related sessions endpoint response shape.'
    return `Related session list returned an invalid payload. ${detail} ${hint}`
  }

  const hint = error?.hint ?? 'Check the project-scoped siblings request and the global recent sessions feed.'
  if (typeof error?.detail === 'string' && error.detail.trim().length > 0) {
    return `Related sessions unavailable right now. ${error.detail} ${hint}`
  }

  return `Related sessions unavailable right now. ${hint}`
}

function getSessionScope(route, data) {
  if (route.view === 'session') {
    const routeProjectRef = hasText(data.detail.sessionDetail?.project_ref)
      ? data.detail.sessionDetail.project_ref
      : route.projectRef
    const routeSessionId = hasText(data.detail.sessionDetail?.session_id)
      ? data.detail.sessionDetail.session_id
      : route.sessionId
    const relatedItems = getSameProjectSiblingItems(
      data.detail.sessionRelatedSessions?.items,
      routeProjectRef,
      routeSessionId,
    )
    const fallbackRecentItems = getSameProjectSiblingItems(
      data.sessions.items,
      routeProjectRef,
      routeSessionId,
    )

    if (data.detail.sessionRelatedSessionsStatus === 'fulfilled') {
      return {
        title: 'Related Sessions',
        items: relatedItems,
        loadState: 'fulfilled',
        loadingText: 'Loading related sessions...',
        emptyText: 'No related sessions available for this project yet.',
        errorText: 'Related session list unavailable right now. Check the dedicated sibling sessions request.',
      }
    }

    if (data.detail.sessionRelatedSessionsStatus === 'error' && data.loadState.sessions === 'fulfilled') {
      return {
        title: 'Related Sessions (recent feed fallback)',
        items: fallbackRecentItems,
        loadState: 'fulfilled',
        loadingText: 'Loading related sessions...',
        emptyText: 'No same-project sessions found in the global recent feed yet.',
        errorText: 'Related session list unavailable right now. Check the dedicated sibling sessions request.',
      }
    }

    if (data.detail.sessionRelatedSessionsStatus === 'error') {
      return {
        title: 'Related Sessions',
        items: [],
        loadState: 'rejected',
        loadingText: 'Loading related sessions...',
        emptyText: 'No related sessions available yet.',
        errorText: buildRelatedSessionsErrorText(data.detail.sessionRelatedSessionsError),
      }
    }

    if (hasText(routeProjectRef) && data.detail.status !== 'error') {
      return {
        title: 'Related Sessions',
        items: [],
        loadState: 'pending',
        loadingText: 'Loading related sessions...',
        emptyText: 'No related sessions available yet.',
        errorText: 'Related session list unavailable right now. Check the dedicated sibling sessions request.',
      }
    }

    return {
      title: 'Related Sessions',
      items: data.sessions.items,
      loadState: data.loadState.sessions,
      loadingText: 'Loading related sessions...',
      emptyText: 'No related sessions available yet.',
      errorText: getSessionListErrorText(
        data.errors?.sessions,
        'Invalid related sessions payload.',
        'Unable to load related sessions yet.',
      ),
    }
  }

  if (route.view !== 'project') {
    return {
      title: 'Recent Sessions',
      items: data.sessions.items,
      loadState: data.loadState.sessions,
      loadingText: 'Loading recent sessions...',
      emptyText: 'No recent sessions yet.',
      errorText: getSessionListErrorText(
        data.errors?.sessions,
        'Invalid recent sessions payload.',
        'Unable to load recent sessions yet.',
      ),
    }
  }

  if (
    data.detail.projectSessionsStatus === 'fulfilled'
    && data.detail.projectSessions
    && (
      data.detail.projectDetailStatus === 'ready'
      || data.detail.projectDetailStatus === 'error'
      || data.detail.projectSessions.items.length > 0
    )
  ) {
    return {
      title: 'Project Sessions',
      items: data.detail.projectSessions.items,
      loadState: 'fulfilled',
      loadingText: 'Loading project sessions...',
      emptyText: 'No sessions recorded for this project yet.',
      errorText: 'Project session list unavailable right now. The project summary above is still available. Check the dedicated project sessions request.',
    }
  }

  if (data.detail.projectDetailStatus === 'error') {
    return {
      title: 'Project Sessions',
      items: [],
      loadState: 'rejected',
      loadingText: 'Loading project sessions...',
      emptyText: 'No sessions recorded for this project yet.',
      errorText: buildProjectSessionsErrorText(data.detail.projectDetailError),
    }
  }

  if (data.detail.projectSessionsStatus === 'error') {
    return {
      title: 'Project Sessions',
      items: [],
      loadState: 'rejected',
      loadingText: 'Loading project sessions...',
      emptyText: 'No sessions recorded for this project yet.',
      errorText: buildProjectSessionsErrorText(data.detail.projectSessionsError),
    }
  }

  return {
    title: 'Project Sessions',
    items: [],
    loadState: 'pending',
    loadingText: 'Loading project sessions...',
    emptyText: 'No sessions recorded for this project yet.',
    errorText: 'Project session list unavailable right now. The project summary above is still available. Check the dedicated project sessions request.',
  }
}

function replaceHash(win, nextHash) {
  if (win.location.hash === nextHash) {
    return
  }

  if (typeof win.history?.replaceState === 'function') {
    win.history.replaceState(null, '', nextHash)
    return
  }

  win.location.hash = nextHash
}

export function createDashboardApp({
  doc = typeof document === 'undefined' ? null : document,
  win = typeof window === 'undefined' ? null : window,
  fetchImpl = fetch,
  contractFetchImpl = typeof document !== 'undefined' && typeof fetch === 'function' ? fetch : null,
} = {}) {
  if (!doc || !win) {
    return {
      async start() {},
    }
  }

  const sections = {
    ...getSections(doc),
    detailPanel: doc.querySelector('#detail-panel'),
  }
  let locale = setCurrentLocale(resolveDashboardLocale({
    cookieHeader: doc.cookie ?? '',
    navigatorLanguages: getPreferredLocales(win),
  }), { doc })
  const dashboardBasePath = getDashboardBasePath(win.location?.pathname)
  const localeCookiePath = dashboardBasePath || '/'
  writeLocaleCookie(doc, locale, localeCookiePath)
  renderLocaleSwitcher(doc, sections, locale)
  updateStaticChrome(sections)
  doc.title = translateText('Clipulse')

  let data = {
    overview: null,
    languages: null,
    models: null,
    hosts: null,
    projects: { items: [] },
    sessions: { items: [] },
    timeseries: { items: [] },
    status: null,
    reports: null,
    providers: null,
    settings: null,
    loadState: {
      overview: 'pending',
      languages: 'pending',
      models: 'pending',
      hosts: 'pending',
      projects: 'pending',
      sessions: 'pending',
      timeseries: 'pending',
      status: 'pending',
      reports: 'pending',
      providers: 'pending',
      settings: 'pending',
    },
    errors: {
      overview: null,
      languages: null,
      models: null,
      hosts: null,
      projects: null,
      sessions: null,
      timeseries: null,
      status: null,
      reports: null,
      providers: null,
      settings: null,
    },
    detail: {
      status: 'idle',
      routeKey: buildHomeHash(),
      requestId: 0,
      projectDetail: null,
      projectDetailStatus: 'idle',
      projectDetailError: null,
      projectSessions: null,
      projectSessionsStatus: 'idle',
      projectSessionsError: null,
      sessionRelatedSessions: null,
      sessionRelatedSessionsStatus: 'idle',
      sessionRelatedSessionsError: null,
      sessionDetail: null,
      error: null,
    },
    compat: {
      mode: 'built-in',
      fallbackSections: [...DASHBOARD_COMPAT_SECTION_NAMES],
      fallbackSectionsLabel: `all ${DASHBOARD_COMPAT_SECTION_NAMES.length} sections`,
      baseSource: 'Remote contract refresh pending; using built-in fallback until the artifact resolves.',
      source: 'Remote contract refresh pending; using built-in fallback until the artifact resolves.',
      meta: DASHBOARD_COMPAT_META_FALLBACK,
      metaLabel: formatDashboardCompatMeta(DASHBOARD_COMPAT_META_FALLBACK, true),
      usingFallback: true,
      hash: null,
    },
  }
  let hasRegisteredHashListener = false
  let startPromise = null
  let hasStartedContractRefresh = false
  let hasRegisteredLogoutListener = false
  let hasRegisteredLocaleListener = false
  let logoutState = {
    status: 'idle',
    message: null,
  }
  const resolveDashboardPath = (resourcePath) => buildDashboardResourcePath(dashboardBasePath, resourcePath)
  const applyLocale = (nextLocale) => {
    locale = setCurrentLocale(nextLocale, { doc })
    writeLocaleCookie(doc, locale, localeCookiePath)
    renderLocaleSwitcher(doc, sections, locale)
    updateStaticChrome(sections)
    rerender()
  }
  const redirectToDashboardSignIn = () => {
    const nextHash = hasText(win.location?.hash) ? win.location.hash : ''
    const nextUrl = `${resolveDashboardPath('/')}${nextHash}`
    if (typeof win.location?.replace === 'function') {
      win.location.replace(nextUrl)
      return
    }
    win.location.hash = nextHash
  }

  const getCompatSection = (sectionName) => data.compat.contract?.[sectionName] ?? DASHBOARD_COMPAT_FALLBACK[sectionName]
  const getCompatSectionForCompat = (compat, sectionName) => (
    compat?.contract?.[sectionName] ?? DASHBOARD_COMPAT_FALLBACK[sectionName]
  )

  const getSummaryItemContracts = () => ({
    language: getCompatSectionForCompat(data.compat, 'languageBreakdownItem'),
    model: getCompatSectionForCompat(data.compat, 'modelBreakdownItem'),
    host: getCompatSectionForCompat(data.compat, 'hostBreakdownItem'),
    project: getCompatSectionForCompat(data.compat, 'projectTopItem'),
    'daily activity': getCompatSectionForCompat(data.compat, 'timeseriesItem'),
  })

  const rerender = () => {
    const route = parseDashboardHash(win.location.hash)
    updateStaticChrome(sections)
    renderLocaleSwitcher(doc, sections, locale)
    renderDashboard(doc, sections, route, data, deriveAuthUiState(data, logoutState))
  }

  const readLogoutFailure = async (response) => {
    let errorBody = null
    try {
      errorBody = await response.json()
    } catch {
      errorBody = null
    }

    const detailPayload = errorBody?.detail && typeof errorBody.detail === 'object'
      ? errorBody.detail
      : null
    const detail = detailPayload?.message ?? errorBody?.detail ?? null
    const hint = detailPayload?.hint ?? null

    if (response?.status === 401) {
      return hint ?? detail ?? 'You are already signed out. Sign in again if you want to reopen the protected dashboard.'
    }

    if (response?.status === 403) {
      return hint ?? detail ?? 'The current account cannot complete dashboard logout.'
    }

    return detail ?? hint ?? `Logout failed with status ${response?.status ?? 0}.`
  }

  const handleLogout = async () => {
    if (logoutState.status === 'loading') {
      return
    }

    const authUiState = deriveAuthUiState(data, logoutState)
    if (authUiState.returnToSignIn && !authUiState.requiresLogoutBeforeSignIn) {
      redirectToDashboardSignIn()
      return
    }

    logoutState = {
      status: 'loading',
      message: 'Signing out of the protected dashboard...',
    }
    rerender()

    try {
      const response = await fetchImpl(resolveDashboardPath('/dashboard-logout'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
      })

      if (response?.status === 401) {
        logoutState = {
          status: 'success',
          message: 'Logged out. Sign in again to reopen the protected dashboard.',
        }
        rerender()
        if (authUiState.requiresLogoutBeforeSignIn) {
          redirectToDashboardSignIn()
        }
        return
      }

      if (!response?.ok) {
        throw new Error(await readLogoutFailure(response))
      }

      logoutState = {
        status: 'success',
        message: 'Logged out. Sign in again to reopen the protected dashboard.',
      }
    } catch (error) {
      const message = hasText(error?.message) ? error.message : 'Logout failed. Try again.'
      logoutState = {
        status: 'error',
        message,
      }
    }

    rerender()
    if (authUiState.requiresLogoutBeforeSignIn && logoutState.status === 'success') {
      redirectToDashboardSignIn()
    }
  }

  const isActiveRouteRequest = (routeKey, requestId) =>
    routeKey === getActiveHref(parseDashboardHash(win.location.hash))
    && data.detail.routeKey === routeKey
    && data.detail.requestId === requestId

  const updateProjectRouteDetail = (routeKey, requestId, patch) => {
    if (!isActiveRouteRequest(routeKey, requestId)) {
      return false
    }

    const nextDetail = {
      ...data.detail,
      ...patch,
      routeKey,
      requestId,
      sessionDetail: null,
    }
    nextDetail.status = nextDetail.projectDetailStatus === 'error'
      ? 'error'
      : nextDetail.projectDetailStatus === 'ready'
        ? 'ready'
        : 'loading'

    data = {
      ...data,
      detail: nextDetail,
    }
    data = revalidateDataWithCompat(data)
    rerender()
    return true
  }

  const updateSessionRouteDetail = (routeKey, requestId, patch) => {
    if (!isActiveRouteRequest(routeKey, requestId)) {
      return false
    }

    const nextDetail = {
      ...data.detail,
      ...patch,
      routeKey,
      requestId,
      projectDetail: null,
      projectDetailStatus: 'idle',
      projectDetailError: null,
      projectSessions: null,
      projectSessionsStatus: 'idle',
      projectSessionsError: null,
    }
    nextDetail.status = nextDetail.error
      ? 'error'
      : nextDetail.sessionDetail
        ? 'ready'
        : 'loading'

    data = {
      ...data,
      detail: nextDetail,
    }
    data = revalidateDataWithCompat(data)
    rerender()
    return true
  }

  const loadSummarySnapshot = async (compat = data.compat) => {
    const summaryContracts = {
      language: getCompatSectionForCompat(compat, 'languageBreakdownItem'),
      model: getCompatSectionForCompat(compat, 'modelBreakdownItem'),
      host: getCompatSectionForCompat(compat, 'hostBreakdownItem'),
      project: getCompatSectionForCompat(compat, 'projectTopItem'),
      'daily activity': getCompatSectionForCompat(compat, 'timeseriesItem'),
    }
    const results = await Promise.allSettled([
      loadJson(resolveDashboardPath('/api/v1/overview'), fetchImpl).then((payload) => validateOverviewPayload(payload)),
      loadJson(resolveDashboardPath('/api/v1/breakdown/languages'), fetchImpl).then((payload) => (
        validateSummaryItemsPayload(payload, 'language', '/api/v1/breakdown/languages', summaryContracts)
      )),
      loadJson(resolveDashboardPath('/api/v1/breakdown/models'), fetchImpl).then((payload) => (
        validateSummaryItemsPayload(payload, 'model', '/api/v1/breakdown/models', summaryContracts)
      )),
      loadJson(resolveDashboardPath('/api/v1/breakdown/hosts'), fetchImpl).then((payload) => (
        validateSummaryItemsPayload(payload, 'host', '/api/v1/breakdown/hosts', summaryContracts)
      )),
      loadJson(resolveDashboardPath('/api/v1/projects/top?limit=5'), fetchImpl).then((payload) => (
        validateSummaryItemsPayload(payload, 'project', '/api/v1/projects/top', summaryContracts)
      )),
      loadSessionListPayload(
        getRecentSessionListPaths().map(resolveDashboardPath),
        fetchImpl,
        'Check the recent sessions endpoint response shape.',
        {
          requireProjectName: false,
        },
        getCompatSectionForCompat(compat, 'sessionListItem'),
      ),
      loadJson(resolveDashboardPath('/api/v1/timeseries'), fetchImpl).then((payload) => (
        validateSummaryItemsPayload(payload, 'daily activity', '/api/v1/timeseries', summaryContracts)
      )),
      loadJson(resolveDashboardPath('/api/v1/status'), fetchImpl).then((payload) => validateStatusPayload(payload)),
      loadJson(resolveDashboardPath('/api/v1/reports/daily'), fetchImpl).then((payload) => (
        validateUsageReportPayload(payload, '/api/v1/reports/daily')
      )),
      loadJson(resolveDashboardPath('/api/v1/providers'), fetchImpl).then((payload) => validateProvidersPayload(payload)),
      loadJson(resolveDashboardPath('/api/v1/menubar/preferences'), fetchImpl).then((payload) => (
        validateMenubarPreferencesPayload(payload)
      )),
    ])

    data = {
      ...buildDataSnapshot(results),
      detail: data.detail,
      compat: data.compat,
    }
    rerender()
  }

  const refreshDashboardCompatContract = () => {
    if (hasStartedContractRefresh) {
      return
    }

    hasStartedContractRefresh = true

    void loadDashboardCompatContract(
      contractFetchImpl,
      resolveDashboardPath('/contracts/dashboard-compat.v1.json'),
    ).then((compat) => {
      data = revalidateDataWithCompat({
        ...data,
        compat,
      })
      rerender()
    })
  }

  const loadRouteDetail = async (route) => {
    if (route.view === 'home' || ['reports', 'providers', 'settings'].includes(route.view)) {
      const requestId = (data.detail.requestId ?? 0) + 1
      data = {
        ...data,
        detail: {
          status: 'idle',
          routeKey: getActiveHref(route),
          requestId,
          staticDetail: buildStaticRouteDetail(route, data),
          projectDetail: null,
          projectDetailStatus: 'idle',
          projectDetailError: null,
          projectSessions: null,
          projectSessionsStatus: 'idle',
          projectSessionsError: null,
          sessionRelatedSessions: null,
          sessionRelatedSessionsStatus: 'idle',
          sessionRelatedSessionsError: null,
          sessionDetail: null,
          error: null,
        },
      }
      rerender()
      return
    }

    const routeKey = route.view === 'project'
      ? buildProjectHash(route.projectRef)
      : buildSessionHash(route.sessionId, route.projectRef)
    if (
      route.view === 'project'
      && data.detail.routeKey === routeKey
      && (
        data.detail.projectDetailStatus === 'loading'
        || data.detail.projectSessionsStatus === 'loading'
      )
    ) {
      return
    }
    if (
      route.view === 'session'
      && data.detail.routeKey === routeKey
      && (data.detail.status === 'loading' || data.detail.status === 'ready')
    ) {
      return
    }

    const requestId = (data.detail.requestId ?? 0) + 1

    data = {
      ...data,
      detail: {
        status: 'loading',
        routeKey,
        requestId,
        projectDetail: null,
        projectDetailStatus: route.view === 'project' ? 'loading' : 'idle',
        projectDetailError: null,
        projectSessions: null,
        projectSessionsStatus: route.view === 'project' ? 'loading' : 'idle',
        projectSessionsError: null,
        sessionRelatedSessions: null,
        sessionRelatedSessionsStatus: route.view === 'session' && route.projectRef ? 'loading' : 'idle',
        sessionRelatedSessionsError: null,
        sessionDetail: null,
        error: null,
      },
    }
    rerender()

    try {
      if (route.view === 'project') {
        void loadSessionListPayload(
          getProjectSessionListPaths(route.projectRef).map(resolveDashboardPath),
          fetchImpl,
          'Check the project sessions endpoint response shape.',
          {
            projectRef: route.projectRef,
            requireProjectName: true,
          },
          getCompatSection('sessionListItem'),
        ).then((payload) => {
          updateProjectRouteDetail(routeKey, requestId, {
            projectSessions: payload,
            projectSessionsStatus: 'fulfilled',
            projectSessionsError: null,
          })
        }).catch((error) => {
          updateProjectRouteDetail(routeKey, requestId, {
            projectSessions: null,
            projectSessionsStatus: 'error',
            projectSessionsError: toDetailError(error),
          })
        })

        await loadJson(resolveDashboardPath(`/api/v1/projects/${encodeURIComponent(route.projectRef)}`), fetchImpl)
          .then((payload) => {
            const safePayload = validateProjectDetailPayload(payload, route.projectRef, getCompatSection('projectDetail'))
            updateProjectRouteDetail(routeKey, requestId, {
              projectDetail: safePayload,
              projectDetailStatus: 'ready',
              projectDetailError: null,
              error: null,
            })
          })
          .catch((error) => {
            const projectDetailError = toDetailError(error)
            updateProjectRouteDetail(routeKey, requestId, {
              projectDetail: null,
              projectDetailStatus: 'error',
              projectDetailError,
              error: projectDetailError,
            })
          })
        return
      }

      const loadSessionRouteSiblings = (projectRef, sessionId, relatedRouteKey = routeKey) => {
        if (!hasText(projectRef)) {
          return
        }

        void loadSessionListPayload(
          getProjectSessionListPaths(projectRef).map(resolveDashboardPath),
          fetchImpl,
          'Check the project sessions endpoint response shape.',
          {
            projectRef,
            requireProjectName: true,
          },
          getCompatSection('sessionListItem'),
        ).then((payload) => {
          updateSessionRouteDetail(relatedRouteKey, requestId, {
            sessionRelatedSessions: payload,
            sessionRelatedSessionsStatus: 'fulfilled',
            sessionRelatedSessionsError: null,
          })
        }).catch((error) => {
          updateSessionRouteDetail(relatedRouteKey, requestId, {
            sessionRelatedSessions: null,
            sessionRelatedSessionsStatus: 'error',
            sessionRelatedSessionsError: toDetailError(error),
          })
        })
      }

      if (route.projectRef) {
        loadSessionRouteSiblings(route.projectRef, route.sessionId, routeKey)
      }

      const payload = await loadJson(
        resolveDashboardPath(
          `/api/v1/sessions/${encodeURIComponent(route.sessionId)}${route.projectRef ? `?project_ref=${encodeURIComponent(route.projectRef)}` : ''}`,
        ),
        fetchImpl,
      )
      const safePayload = validateSessionDetailPayload(payload, route, getCompatSection('sessionDetail'))

      if (!isActiveRouteRequest(routeKey, requestId)) {
        return
      }

      const normalizedRouteKey = !route.projectRef && safePayload.project_ref
        ? buildSessionHash(safePayload.session_id, safePayload.project_ref)
        : routeKey

      const nextSessionRelatedStatus = hasText(route.projectRef) || hasText(safePayload.project_ref)
        ? data.detail.sessionRelatedSessionsStatus === 'idle'
          ? 'loading'
          : data.detail.sessionRelatedSessionsStatus
        : 'idle'

      data = {
        ...data,
        detail: {
          status: 'ready',
          routeKey: normalizedRouteKey,
          requestId,
          projectDetail: null,
          projectDetailStatus: 'idle',
          projectDetailError: null,
          projectSessions: null,
          projectSessionsStatus: 'idle',
          projectSessionsError: null,
          sessionRelatedSessions: data.detail.sessionRelatedSessions,
          sessionRelatedSessionsStatus: nextSessionRelatedStatus,
          sessionRelatedSessionsError: data.detail.sessionRelatedSessionsError,
          sessionDetail: safePayload,
          error: null,
        },
      }

      if (!route.projectRef && safePayload.project_ref) {
        replaceHash(win, normalizedRouteKey)
      }

      rerender()

      if (!route.projectRef && hasText(safePayload.project_ref)) {
        loadSessionRouteSiblings(safePayload.project_ref, safePayload.session_id, normalizedRouteKey)
      }
    } catch (error) {
      if (!isActiveRouteRequest(routeKey, requestId)) {
        return
      }

      data = {
        ...data,
        detail: {
          status: 'error',
          routeKey,
          requestId,
          projectDetail: null,
          projectDetailStatus: 'idle',
          projectDetailError: null,
          projectSessions: null,
          projectSessionsStatus: 'idle',
          projectSessionsError: null,
          sessionRelatedSessions: null,
          sessionRelatedSessionsStatus: 'idle',
          sessionRelatedSessionsError: null,
          sessionDetail: null,
          error: {
            status: error.status ?? 0,
            code: error.code ?? null,
            detail: error.detail ?? null,
            hint: error.hint ?? null,
          },
        },
      }
      rerender()
    }
  }

  return {
    async start() {
      if (startPromise) {
        await startPromise
        return
      }

      startPromise = (async () => {
        rerender()
        refreshDashboardCompatContract()

        if (!hasRegisteredLogoutListener && sections.logoutButton?.addEventListener) {
          sections.logoutButton.addEventListener('click', () => handleLogout())
          hasRegisteredLogoutListener = true
        }

        if (!hasRegisteredLocaleListener && sections.localeSwitcher?.addEventListener) {
          sections.localeSwitcher.addEventListener('change', () => {
            applyLocale(sections.localeSwitcher.value)
          })
          hasRegisteredLocaleListener = true
        }

        if (!hasRegisteredHashListener) {
          win.addEventListener('hashchange', () => {
            rerender()
            void loadRouteDetail(parseDashboardHash(win.location.hash))
          })
          hasRegisteredHashListener = true
        }

        void loadRouteDetail(parseDashboardHash(win.location.hash))

        const results = await Promise.allSettled([
          loadJson(resolveDashboardPath('/api/v1/overview'), fetchImpl).then((payload) => validateOverviewPayload(payload)),
          loadJson(resolveDashboardPath('/api/v1/breakdown/languages'), fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'language', '/api/v1/breakdown/languages', getSummaryItemContracts())
          )),
          loadJson(resolveDashboardPath('/api/v1/breakdown/models'), fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'model', '/api/v1/breakdown/models', getSummaryItemContracts())
          )),
          loadJson(resolveDashboardPath('/api/v1/breakdown/hosts'), fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'host', '/api/v1/breakdown/hosts', getSummaryItemContracts())
          )),
          loadJson(resolveDashboardPath('/api/v1/projects/top?limit=5'), fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'project', '/api/v1/projects/top', getSummaryItemContracts())
          )),
          loadSessionListPayload(
            getRecentSessionListPaths().map(resolveDashboardPath),
            fetchImpl,
            'Check the recent sessions endpoint response shape.',
            {
              requireProjectName: false,
            },
            getCompatSection('sessionListItem'),
          ),
          loadJson(resolveDashboardPath('/api/v1/timeseries'), fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'daily activity', '/api/v1/timeseries', getSummaryItemContracts())
          )),
          loadJson(resolveDashboardPath('/api/v1/status'), fetchImpl).then((payload) => validateStatusPayload(payload)),
          loadJson(resolveDashboardPath('/api/v1/reports/daily'), fetchImpl).then((payload) => (
            validateUsageReportPayload(payload, '/api/v1/reports/daily')
          )),
          loadJson(resolveDashboardPath('/api/v1/providers'), fetchImpl).then((payload) => validateProvidersPayload(payload)),
          loadJson(resolveDashboardPath('/api/v1/menubar/preferences'), fetchImpl).then((payload) => (
            validateMenubarPreferencesPayload(payload)
          )),
        ])

        data = revalidateDataWithCompat({
          ...buildDataSnapshot(results),
          detail: data.detail,
          compat: data.compat,
        })
        rerender()
        await loadRouteDetail(parseDashboardHash(win.location.hash))
        await Promise.resolve()
        await Promise.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })()

      await startPromise
    },
  }
}

function toDetailError(error) {
  return {
    status: error?.status ?? 0,
    code: error?.code ?? null,
    detail: error?.detail ?? null,
    hint: error?.hint ?? null,
  }
}

function reconcileCompatStatusMetadata(compat, status) {
  if (!compat) {
    return compat
  }

  const baseSource = compat.baseSource ?? compat.source ?? null
  const baseSourceKind = compat.baseSourceKind ?? compat.sourceKind ?? compat.source_kind ?? null
  const compatHash = normalizeCompatHash(compat.hash)
  const statusHash = normalizeCompatHash(status?.compat?.hash)
  const nextCompat = {
    ...compat,
    baseSource,
    baseSourceKind,
    source: baseSource,
    sourceKind: baseSourceKind,
    source_kind: baseSourceKind,
    hash: compatHash,
    hashDrift: null,
  }

  if (!compatHash || !statusHash || compatHash === statusHash) {
    return nextCompat
  }

  return {
    ...nextCompat,
    source: `${baseSource ?? 'Remote contract loaded.'} /api/v1/status reports compat hash drift: API ${statusHash}, dashboard ${compatHash}.`,
    sourceKind: 'hash_drift',
    source_kind: 'hash_drift',
    hashDrift: {
      statusHash,
      loadedHash: compatHash,
    },
  }
}

function buildProjectSessionsErrorText(error) {
  if (isInvalidListError(error)) {
    const detail = error?.detail ?? 'Project sessions did not match the expected payload shape.'
    const hint = error?.hint ?? 'Check the project sessions endpoint response shape.'
    return `Project session list returned an invalid payload. ${detail} ${hint}`
  }

  if (error?.code === 'project_not_found') {
    return 'Project session list unavailable. Open the home view and reselect a project from the latest snapshot.'
  }

  const hint = error?.hint ?? 'Check the dedicated project sessions request.'
  if (typeof error?.detail === 'string' && error.detail.trim().length > 0) {
    return `Project session list unavailable right now. The project summary above is still available. ${error.detail} ${hint}`
  }
  return `Project session list unavailable right now. The project summary above is still available. ${hint}`
}

function createInvalidDetailPayloadError(detail, hint = 'Check the dedicated detail endpoint response shape.') {
  const error = new Error(detail)
  error.status = 200
  error.code = 'invalid_detail_payload'
  error.detail = detail
  error.hint = hint
  return error
}

function validateProjectDetailPayload(payload, routeProjectRef, contract = DASHBOARD_COMPAT_FALLBACK.projectDetail) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createInvalidDetailPayloadError('Detail response must be a JSON object.')
  }

  const missingFields = collectMissingContractFields(payload, contract)
  if (missingFields.length > 0) {
    throw createInvalidDetailPayloadError(`Missing required detail fields: ${missingFields.join(', ')}`)
  }

  if (payload.project_ref !== routeProjectRef) {
    throw createInvalidDetailPayloadError('Detail payload does not match current route identity: project_ref')
  }

  return normalizePayloadWithContract(payload, contract)
}

function validateSessionDetailPayload(payload, route, contract = DASHBOARD_COMPAT_FALLBACK.sessionDetail) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createInvalidDetailPayloadError('Detail response must be a JSON object.')
  }

  const missingFields = collectMissingContractFields(payload, contract)
  if (missingFields.length > 0) {
    throw createInvalidDetailPayloadError(`Missing required detail fields: ${missingFields.join(', ')}`)
  }

  const identityMismatches = []
  if (payload.session_id !== route.sessionId) {
    identityMismatches.push('session_id')
  }
  if (route.projectRef && payload.project_ref !== route.projectRef) {
    identityMismatches.push('project_ref')
  }

  if (identityMismatches.length > 0) {
    throw createInvalidDetailPayloadError(
      `Detail payload does not match current route identity: ${identityMismatches.join(', ')}`,
    )
  }

  return normalizePayloadWithContract(payload, contract)
}

function revalidateDataWithCompat(nextData) {
  const compat = reconcileCompatStatusMetadata(nextData?.compat, nextData?.status)
  const getCompatSection = (sectionName) => compat?.contract?.[sectionName] ?? DASHBOARD_COMPAT_FALLBACK[sectionName]
  const summaryItemContracts = {
    language: getCompatSection('languageBreakdownItem'),
    model: getCompatSection('modelBreakdownItem'),
    host: getCompatSection('hostBreakdownItem'),
    project: getCompatSection('projectTopItem'),
    'daily activity': getCompatSection('timeseriesItem'),
  }
  const revalidated = {
    ...nextData,
    compat,
    loadState: { ...nextData.loadState },
    errors: { ...nextData.errors },
    detail: { ...nextData.detail },
  }

  const revalidateSummaryFeed = (key, emptyValue, validator) => {
    if (revalidated.loadState?.[key] !== 'fulfilled') {
      return
    }

    try {
      revalidated[key] = validator()
      revalidated.errors[key] = null
    } catch (error) {
      revalidated[key] = emptyValue
      revalidated.loadState[key] = 'rejected'
      revalidated.errors[key] = toDetailError(error)
    }
  }

  revalidateSummaryFeed('overview', null, () => validateOverviewPayload(revalidated.overview))
  revalidateSummaryFeed('languages', { items: [] }, () => (
    validateSummaryItemsPayload(
      revalidated.languages,
      'language',
      '/api/v1/breakdown/languages',
      summaryItemContracts,
    )
  ))
  revalidateSummaryFeed('models', { items: [] }, () => (
    validateSummaryItemsPayload(
      revalidated.models,
      'model',
      '/api/v1/breakdown/models',
      summaryItemContracts,
    )
  ))
  revalidateSummaryFeed('hosts', { items: [] }, () => (
    validateSummaryItemsPayload(
      revalidated.hosts,
      'host',
      '/api/v1/breakdown/hosts',
      summaryItemContracts,
    )
  ))
  revalidateSummaryFeed('projects', { items: [] }, () => (
    validateSummaryItemsPayload(
      revalidated.projects,
      'project',
      '/api/v1/projects/top',
      summaryItemContracts,
    )
  ))
  revalidateSummaryFeed('sessions', { items: [] }, () => (
    validateItemsPayload(
      revalidated.sessions,
      'Check the recent sessions endpoint response shape.',
      {
        requireProjectName: false,
      },
      getCompatSection('sessionListItem'),
    )
  ))
  revalidateSummaryFeed('timeseries', { items: [] }, () => (
    validateSummaryItemsPayload(
      revalidated.timeseries,
      'daily activity',
      '/api/v1/timeseries',
      summaryItemContracts,
    )
  ))
  revalidateSummaryFeed('status', null, () => validateStatusPayload(revalidated.status))

  if (revalidated.detail?.projectDetailStatus === 'ready' && revalidated.detail.projectDetail) {
    try {
      revalidated.detail.projectDetail = validateProjectDetailPayload(
        revalidated.detail.projectDetail,
        revalidated.detail.projectDetail.project_ref,
        getCompatSection('projectDetail'),
      )
      revalidated.detail.projectDetailError = null
      if (revalidated.detail.status === 'error' && revalidated.detail.error?.code === 'invalid_detail_payload') {
        revalidated.detail.error = null
        revalidated.detail.status = 'ready'
      }
    } catch (error) {
      const detailError = toDetailError(error)
      revalidated.detail.projectDetail = null
      revalidated.detail.projectDetailStatus = 'error'
      revalidated.detail.projectDetailError = detailError
      revalidated.detail.error = detailError
      revalidated.detail.status = 'error'
    }
  }

  if (revalidated.detail?.projectSessionsStatus === 'fulfilled' && revalidated.detail.projectSessions) {
    try {
      revalidated.detail.projectSessions = validateItemsPayload(
        revalidated.detail.projectSessions,
        'Check the project sessions endpoint response shape.',
        {
          projectRef: revalidated.detail.projectSessions.project_ref ?? revalidated.detail.projectDetail?.project_ref ?? null,
          requireProjectName: true,
        },
        getCompatSection('sessionListItem'),
      )
      revalidated.detail.projectSessionsError = null
    } catch (error) {
      revalidated.detail.projectSessions = null
      revalidated.detail.projectSessionsStatus = 'error'
      revalidated.detail.projectSessionsError = toDetailError(error)
    }
  }

  if (revalidated.detail?.status === 'ready' && revalidated.detail.sessionDetail) {
    try {
      revalidated.detail.sessionDetail = validateSessionDetailPayload(
        revalidated.detail.sessionDetail,
        {
          view: 'session',
          sessionId: revalidated.detail.sessionDetail.session_id,
          projectRef: revalidated.detail.sessionDetail.project_ref ?? null,
        },
        getCompatSection('sessionDetail'),
      )
      revalidated.detail.error = null
    } catch (error) {
      revalidated.detail.sessionDetail = null
      revalidated.detail.status = 'error'
      revalidated.detail.error = toDetailError(error)
    }
  }

  if (revalidated.detail?.sessionRelatedSessionsStatus === 'fulfilled' && revalidated.detail.sessionRelatedSessions) {
    try {
      revalidated.detail.sessionRelatedSessions = validateItemsPayload(
        revalidated.detail.sessionRelatedSessions,
        'Check the project sessions endpoint response shape.',
        {
          projectRef: revalidated.detail.sessionRelatedSessions.project_ref ?? revalidated.detail.sessionDetail?.project_ref ?? null,
          requireProjectName: true,
        },
        getCompatSection('sessionListItem'),
      )
      revalidated.detail.sessionRelatedSessionsError = null
    } catch (error) {
      revalidated.detail.sessionRelatedSessions = null
      revalidated.detail.sessionRelatedSessionsStatus = 'error'
      revalidated.detail.sessionRelatedSessionsError = toDetailError(error)
    }
  }

  return revalidated
}

export async function bootstrapDashboard() {
  const app = createDashboardApp()
  await app.start()
  await registerDashboardServiceWorker()
}

export async function registerDashboardServiceWorker(navigatorLike = globalThis.navigator) {
  const serviceWorker = navigatorLike?.serviceWorker
  if (!serviceWorker || typeof serviceWorker.register !== 'function') {
    return false
  }

  try {
    await serviceWorker.register(resolveDashboardServiceWorkerURL())
    return true
  } catch {
    return false
  }
}

export function resolveDashboardServiceWorkerURL(documentLike = globalThis.document) {
  const baseURI = documentLike?.baseURI
  if (!baseURI) {
    return './sw.js'
  }
  return new URL('sw.js', baseURI).toString()
}
