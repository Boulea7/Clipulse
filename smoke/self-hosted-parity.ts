import { expect } from 'vitest'

interface HostModelMixEntryLike {
  active_ms?: number
  events?: number
  host?: string
  model_name?: string
  wait_ms?: number
}

interface HostModelRollupLike {
  host?: string
  host_model_mix?: HostModelMixEntryLike[]
  host_model_mix_count?: number
  host_model_primary?: HostModelMixEntryLike | null
  last_git_branch?: string
  last_host?: string
  last_model_name?: string
}

export interface SessionListItemLike extends HostModelRollupLike {
  active_ms?: number
  changed_files_count?: number
  changed_languages_count?: number
  event_count?: number
  events?: number
  last_event_name?: string
  last_event_time?: string
  lines_added?: number
  lines_changed?: number
  lines_removed?: number
  project_name?: string
  project_ref?: string
  session_id?: string
  top_language?: { changed?: number; name?: string } | null
  wait_ms?: number
}

interface SessionListResponseLike {
  items: SessionListItemLike[]
  [key: string]: unknown
}

interface ProjectDetailLike extends HostModelRollupLike {
  active_ms?: number
  changed_files_count?: number
  changed_languages_count?: number
  event_count?: number
  events?: number
  last_event_name?: string
  last_event_time?: string
  last_git_branch?: string
  lines_added?: number
  lines_changed?: number
  lines_removed?: number
  project_name?: string
  project_ref?: string
  session_count?: number
  top_language?: { changed?: number; name?: string } | null
  wait_ms?: number
}

interface ProjectSessionsResponseLike {
  items: SessionListItemLike[]
  project_name?: string
  project_ref?: string
}

interface SessionDetailLike extends SessionListItemLike {
  host_model_mix?: HostModelMixEntryLike[]
}

interface HostModelExpectation {
  host: string
  model_name: string
}

interface QueueSpoolLike {
  backlog_mode?: string
  oldest_backlog_age_seconds?: number
  oldest_quarantine_age_seconds?: number
  orphan_sidecars?: {
    processing?: number
    quarantine?: number
    ready?: number
    total?: number
  }
  processing?: number
  processing_bytes?: number
  quarantine?: number
  quarantine_bytes?: number
  quarantine_meta_error_counts?: Record<string, number>
  quarantine_reason_counts?: Record<string, number>
  ready?: number
  ready_bytes?: number
  state_dir?: string
  state_dir_exists?: boolean
  state_dir_kind?: string
}

interface QueueEntryExpectation {
  file_name: string
  reason?: string
  source_state?: 'ready' | 'processing' | 'quarantine'
  state: 'ready' | 'processing' | 'quarantine'
}

interface AssertQueueParityOptions {
  expectedBacklogMode?: string
  doctorOutput: string
  doctorStateDir?: string
  expectedDoctorHints?: string[]
  expectedEntries?: QueueEntryExpectation[]
  expectedOrphanSidecars?: {
    processing?: number
    quarantine?: number
    ready?: number
    total?: number
  }
  expectedQuarantineReasonCounts?: Record<string, number>
  pendingOutput: string
  expectedStateDirKind?: string
}

interface AssertProjectRollupOptions {
  expectedHostModels?: HostModelExpectation[]
}

interface AssertSessionDetailConsistencyOptions {
  detail: SessionDetailLike
  expectedHost: string
  expectedHostModels?: HostModelExpectation[]
  projectSummary: SessionListItemLike
  recentSummary: SessionListItemLike
}

interface AssertProjectDetailConsistencyOptions {
  detail: ProjectDetailLike
  projectSessions: ProjectSessionsResponseLike
  projectSummary: ProjectDetailLike
}

function getEventCount(item: { event_count?: number; events?: number } | undefined) {
  return item?.event_count ?? item?.events ?? null
}

function getPrimaryHost(item: { host?: string; last_host?: string } | undefined) {
  return item?.host ?? item?.last_host ?? null
}

function buildSessionListKey(item: { project_ref?: string; session_id?: string } | undefined) {
  return `${item?.project_ref ?? ''}::${item?.session_id ?? ''}`
}

function normalizeHostModelExpectation(entry: HostModelMixEntryLike | undefined) {
  return {
    active_ms: entry?.active_ms ?? null,
    events: entry?.events ?? null,
    host: entry?.host ?? null,
    model_name: entry?.model_name ?? null,
    wait_ms: entry?.wait_ms ?? null,
  }
}

function normalizeExpectedHostModelPresence(entry: HostModelExpectation | undefined) {
  return {
    host: entry?.host ?? null,
    model_name: entry?.model_name ?? null,
  }
}

export function normalizeHostModelMixForParity(item: HostModelRollupLike | undefined) {
  const mix = Array.isArray(item?.host_model_mix) ? item.host_model_mix : []
  return mix.map((entry) => normalizeHostModelExpectation(entry))
}

export function normalizeSessionListItemForParity(item: SessionListItemLike | undefined) {
  return {
    active_ms: item?.active_ms ?? null,
    changed_files_count: item?.changed_files_count ?? null,
    changed_languages_count: item?.changed_languages_count ?? null,
    event_count: getEventCount(item),
    host: getPrimaryHost(item),
    host_model_mix_count: item?.host_model_mix_count ?? null,
    host_model_primary: item?.host_model_primary ?? null,
    last_event_name: item?.last_event_name ?? null,
    last_event_time: item?.last_event_time ?? null,
    last_model_name: item?.last_model_name ?? null,
    lines_added: item?.lines_added ?? null,
    lines_changed: item?.lines_changed ?? null,
    lines_removed: item?.lines_removed ?? null,
    project_name: item?.project_name ?? null,
    project_ref: item?.project_ref ?? null,
    session_id: item?.session_id ?? null,
    top_language: item?.top_language ?? null,
    wait_ms: item?.wait_ms ?? null,
  }
}

export function findSessionItemById(
  items: SessionListItemLike[],
  sessionId: string,
  projectRef?: string,
) {
  return items.find((item) => (
    item.session_id === sessionId
    && (projectRef === undefined || item.project_ref === projectRef)
  ))
}

export function assertHostModelRollupConsistency(
  item: HostModelRollupLike | undefined,
  expectedHostModels: HostModelExpectation[] = [],
) {
  const mix = Array.isArray(item?.host_model_mix) ? item.host_model_mix : []

  expect(item?.host_model_mix_count ?? 0).toBe(mix.length)

  if (mix.length === 0) {
    expect(item?.host_model_primary ?? null).toBeNull()
  } else {
    expect(item?.host_model_primary).toEqual(mix[0])
  }

  if (expectedHostModels.length > 0) {
    expect(mix.map((entry) => normalizeHostModelExpectation(entry))).toEqual(expect.arrayContaining(
      expectedHostModels.map((entry) => expect.objectContaining(
        normalizeExpectedHostModelPresence(entry),
      )),
    ))
  }
}

export function assertExactHostModelMixParity(...items: Array<HostModelRollupLike | undefined>) {
  const normalizedItems = items.map((item) => normalizeHostModelMixForParity(item))
  const [firstItem, ...restItems] = normalizedItems

  for (const item of restItems) {
    expect(item).toEqual(firstItem)
  }
}

export function assertQueueParityConsistency(
  spool: QueueSpoolLike,
  {
    expectedBacklogMode,
    doctorStateDir,
    doctorOutput,
    expectedDoctorHints = [],
    expectedEntries = [],
    expectedOrphanSidecars,
    expectedQuarantineReasonCounts = {},
    pendingOutput,
    expectedStateDirKind,
  }: AssertQueueParityOptions,
) {
  const localStateDirLabel = typeof doctorStateDir === 'string' && doctorStateDir.trim().length > 0
    ? doctorStateDir
    : spool.state_dir
  expect(spool.state_dir).toBeTruthy()
  expect(spool.state_dir_exists).toBe(true)
  expect(spool.oldest_backlog_age_seconds ?? -1).toBeGreaterThanOrEqual(0)
  expect(spool.oldest_quarantine_age_seconds ?? -1).toBeGreaterThanOrEqual(0)

  if (expectedBacklogMode) {
    expect(spool.backlog_mode ?? null).toBe(expectedBacklogMode)
  }

  if (expectedStateDirKind) {
    expect(spool.state_dir_kind ?? null).toBe(expectedStateDirKind)
  }

  expect(doctorOutput).toContain(`state dir: ${localStateDirLabel}`)
  if (spool.state_dir_kind) {
    expect(doctorOutput).toContain(`state dir kind: ${spool.state_dir_kind}`)
    expect(pendingOutput).toContain(`state dir kind: ${spool.state_dir_kind}`)
  }
  expect(doctorOutput).toContain(
    `ready: ${spool.ready ?? 0} | processing: ${spool.processing ?? 0} | quarantine: ${spool.quarantine ?? 0}`,
  )
  expect(doctorOutput).toContain(
    `payload bytes: ready=${spool.ready_bytes ?? 0} processing=${spool.processing_bytes ?? 0} quarantine=${spool.quarantine_bytes ?? 0}`,
  )
  expect(pendingOutput).toContain(`state dir: ${localStateDirLabel}`)

  for (const hint of expectedDoctorHints) {
    expect(doctorOutput).toContain(hint)
  }

  if (expectedOrphanSidecars) {
    expect(spool.orphan_sidecars ?? {}).toEqual(expect.objectContaining(expectedOrphanSidecars))

    const ready = expectedOrphanSidecars.ready ?? 0
    const processing = expectedOrphanSidecars.processing ?? 0
    const quarantine = expectedOrphanSidecars.quarantine ?? 0
    const orphanSummary = `orphan metadata sidecars: ready=${ready} processing=${processing} quarantine=${quarantine}`

    if ((expectedOrphanSidecars.total ?? ready + processing + quarantine) > 0) {
      expect(doctorOutput).toContain(orphanSummary)
      expect(pendingOutput).toContain(orphanSummary)
    }
  }

  if (expectedEntries.length === 0) {
    expect(pendingOutput).toContain('no payload backlog entries')
  } else {
    for (const entry of expectedEntries) {
      expect(pendingOutput).toContain(`[${entry.state}] ${entry.file_name}`)
      if (entry.reason) {
        expect(pendingOutput).toContain(`reason=${entry.reason}`)
      }
      if (entry.source_state) {
        expect(pendingOutput).toContain(`source_state=${entry.source_state}`)
      }
    }
  }

  const quarantineReasonEntries = Object.entries(expectedQuarantineReasonCounts)
  if (quarantineReasonEntries.length > 0) {
    expect(doctorOutput).toContain('quarantine reasons:')
    for (const [reason, count] of quarantineReasonEntries) {
      expect(doctorOutput).toContain(`${reason}=${count}`)
    }
  }

  const quarantineMetaErrorEntries = Object.entries(spool.quarantine_meta_error_counts ?? {})
    .filter(([, count]) => count > 0)
  if (quarantineMetaErrorEntries.length > 0) {
    expect(doctorOutput).toContain('quarantine metadata errors:')
    expect(pendingOutput).toContain('quarantine metadata errors:')
    for (const [reason, count] of quarantineMetaErrorEntries) {
      expect(doctorOutput).toContain(`${reason}=${count}`)
      expect(pendingOutput).toContain(`${reason}=${count}`)
    }
  }
}

export function assertSessionListResponseParity(
  fullResponse: SessionListResponseLike,
  compactResponse: SessionListResponseLike,
) {
  const { items: fullItems, ...fullRest } = fullResponse
  const { items: compactItems, ...compactRest } = compactResponse

  expect(compactRest).toEqual(fullRest)

  const fullItemsByKey = new Map(fullItems.map((item) => [buildSessionListKey(item), item]))
  const compactItemsByKey = new Map(compactItems.map((item) => [buildSessionListKey(item), item]))

  expect(fullItemsByKey.size).toBe(fullItems.length)
  expect(compactItemsByKey.size).toBe(compactItems.length)
  expect([...compactItemsByKey.keys()]).toEqual([...fullItemsByKey.keys()])

  for (const [sessionKey, fullItem] of fullItemsByKey.entries()) {
    assertHostModelRollupConsistency(fullItem)

    const compactItem = compactItemsByKey.get(sessionKey)
    expect(compactItem).toBeDefined()
    expect(compactItem?.host_model_mix).toBeUndefined()
    const { host_model_mix: _hostModelMix, ...sharedFields } = fullItem
    expect(compactItem).toEqual({
      ...sharedFields,
    })
  }
}

export function assertProjectRollupConsistency(
  projectDetail: ProjectDetailLike,
  projectSessions: ProjectSessionsResponseLike,
  expectedSessionIds: string[],
  options: AssertProjectRollupOptions = {},
) {
  expect(projectDetail.project_ref).toBe(projectSessions.project_ref)
  expect(projectDetail.project_ref).toBeTruthy()
  expect(projectDetail.project_name ?? null).toBe(projectSessions.project_name ?? null)
  expect(projectDetail.session_count).toBe(expectedSessionIds.length)
  expect(projectSessions.items.map((item) => item.session_id).sort()).toEqual([...expectedSessionIds].sort())
  expect(getEventCount(projectDetail)).toBe(
    projectSessions.items.reduce((sum, item) => sum + (getEventCount(item) ?? 0), 0),
  )
  assertHostModelRollupConsistency(projectDetail, options.expectedHostModels)
}

export function assertProjectDetailConsistency({
  detail,
  projectSessions,
  projectSummary,
}: AssertProjectDetailConsistencyOptions) {
  expect(detail.project_ref).toBe(projectSummary.project_ref)
  expect(detail.project_name ?? null).toBe(projectSummary.project_name ?? null)
  expect(detail.project_name ?? null).toBe(projectSessions.project_name ?? null)
  expect(getEventCount(detail)).toBe(getEventCount(projectSummary))
  expect(detail.active_ms ?? null).toBe(projectSummary.active_ms ?? null)
  expect(detail.wait_ms ?? null).toBe(projectSummary.wait_ms ?? null)
  expect(detail.changed_files_count ?? null).toBe(projectSummary.changed_files_count ?? null)
  expect(detail.changed_languages_count ?? null).toBe(projectSummary.changed_languages_count ?? null)
  expect(detail.lines_added ?? null).toBe(projectSummary.lines_added ?? null)
  expect(detail.lines_removed ?? null).toBe(projectSummary.lines_removed ?? null)
  expect(detail.lines_changed ?? null).toBe(projectSummary.lines_changed ?? null)
  expect(detail.last_event_time ?? null).toBe(projectSummary.last_event_time ?? null)
  expect(detail.last_event_name ?? null).toBe(projectSummary.last_event_name ?? null)
  expect(detail.last_host ?? null).toBe(projectSummary.last_host ?? null)
  expect(detail.last_model_name ?? null).toBe(projectSummary.last_model_name ?? null)
  expect(detail.last_git_branch ?? null).toBe(projectSummary.last_git_branch ?? null)
  expect(detail.top_language ?? null).toEqual(projectSummary.top_language ?? null)

  expect(detail.session_count ?? null).toBe(projectSessions.items.length)
  expect(getEventCount(detail)).toBe(
    projectSessions.items.reduce((sum, item) => sum + (getEventCount(item) ?? 0), 0),
  )
  expect(detail.active_ms ?? null).toBe(
    projectSessions.items.reduce((sum, item) => sum + (item.active_ms ?? 0), 0),
  )
  expect(detail.wait_ms ?? null).toBe(
    projectSessions.items.reduce((sum, item) => sum + (item.wait_ms ?? 0), 0),
  )
  expect(detail.changed_files_count ?? 0).toBeGreaterThanOrEqual(0)
  expect(detail.changed_languages_count ?? 0).toBeGreaterThanOrEqual(0)
  expect(detail.lines_added ?? null).toBe(
    projectSessions.items.reduce((sum, item) => sum + (item.lines_added ?? 0), 0),
  )
  expect(detail.lines_removed ?? null).toBe(
    projectSessions.items.reduce((sum, item) => sum + (item.lines_removed ?? 0), 0),
  )
  expect(detail.lines_changed ?? null).toBe(
    projectSessions.items.reduce((sum, item) => sum + (item.lines_changed ?? 0), 0),
  )

  const latestSession = [...projectSessions.items].sort((left, right) =>
    `${right.last_event_time ?? ''}`.localeCompare(`${left.last_event_time ?? ''}`)
  )[0]

  expect(detail.last_event_time ?? null).toBe(latestSession?.last_event_time ?? null)
  expect(detail.last_event_name ?? null).toBe(latestSession?.last_event_name ?? null)
  expect(detail.last_host ?? null).toBe(getPrimaryHost(latestSession))
  expect(detail.last_model_name ?? null).toBe(latestSession?.last_model_name ?? null)
  expect(detail.last_git_branch ?? null).toBe(latestSession?.last_git_branch ?? null)
  assertHostModelRollupConsistency(detail)
}

export function assertSessionDetailConsistency({
  detail,
  expectedHost,
  expectedHostModels = [],
  projectSummary,
  recentSummary,
}: AssertSessionDetailConsistencyOptions) {
  expect(detail.session_id).toBe(recentSummary.session_id)
  expect(detail.session_id).toBe(projectSummary.session_id)
  expect(detail.project_ref).toBe(recentSummary.project_ref)
  expect(detail.project_ref).toBe(projectSummary.project_ref)
  expect(detail.project_name ?? null).toBe(recentSummary.project_name ?? null)
  expect(detail.project_name ?? null).toBe(projectSummary.project_name ?? null)
  expect(getPrimaryHost(detail)).toBe(expectedHost)

  const recentEventCount = getEventCount(recentSummary)
  const projectEventCount = getEventCount(projectSummary)
  const detailEventCount = getEventCount(detail)
  expect(detailEventCount).toBe(recentEventCount)
  expect(detailEventCount).toBe(projectEventCount)
  expect(detail.active_ms ?? null).toBe(recentSummary.active_ms ?? null)
  expect(detail.active_ms ?? null).toBe(projectSummary.active_ms ?? null)
  expect(detail.wait_ms ?? null).toBe(recentSummary.wait_ms ?? null)
  expect(detail.wait_ms ?? null).toBe(projectSummary.wait_ms ?? null)
  expect(detail.last_event_time ?? null).toBe(recentSummary.last_event_time ?? null)
  expect(detail.last_event_time ?? null).toBe(projectSummary.last_event_time ?? null)
  expect(detail.last_event_name ?? null).toBe(recentSummary.last_event_name ?? null)
  expect(detail.last_event_name ?? null).toBe(projectSummary.last_event_name ?? null)
  expect(detail.last_model_name ?? null).toBe(recentSummary.last_model_name ?? null)
  expect(detail.last_model_name ?? null).toBe(projectSummary.last_model_name ?? null)
  expect(getPrimaryHost(detail)).toBe(getPrimaryHost(recentSummary))
  expect(getPrimaryHost(detail)).toBe(getPrimaryHost(projectSummary))
  expect(detail.last_git_branch ?? null).toBe(projectSummary.last_git_branch ?? null)
  expect(detail.last_git_branch ?? null).toBe(recentSummary.last_git_branch ?? null)
  expect(detail.lines_added ?? null).toBe(recentSummary.lines_added ?? null)
  expect(detail.lines_added ?? null).toBe(projectSummary.lines_added ?? null)
  expect(detail.lines_removed ?? null).toBe(recentSummary.lines_removed ?? null)
  expect(detail.lines_removed ?? null).toBe(projectSummary.lines_removed ?? null)
  expect(detail.lines_changed ?? null).toBe(recentSummary.lines_changed ?? null)
  expect(detail.lines_changed ?? null).toBe(projectSummary.lines_changed ?? null)
  expect(detail.changed_languages_count ?? null).toBe(recentSummary.changed_languages_count ?? null)
  expect(detail.changed_languages_count ?? null).toBe(projectSummary.changed_languages_count ?? null)
  expect(detail.top_language ?? null).toEqual(recentSummary.top_language ?? null)
  expect(detail.top_language ?? null).toEqual(projectSummary.top_language ?? null)

  expect(detail.changed_files_count).toEqual(expect.any(Number))
  const expectedChangedFilesCounts = [
    recentSummary.changed_files_count,
    projectSummary.changed_files_count,
  ].filter((value): value is number => typeof value === 'number')

  if (expectedChangedFilesCounts.length > 0) {
    for (const expectedChangedFilesCount of expectedChangedFilesCounts) {
      expect(detail.changed_files_count).toBe(expectedChangedFilesCount)
    }
  } else {
    expect(detail.changed_files_count).toBeGreaterThanOrEqual(0)
  }

  expect(detail.host_model_mix_count).toBe(recentSummary.host_model_mix_count)
  expect(detail.host_model_mix_count).toBe(projectSummary.host_model_mix_count)
  expect(detail.host_model_primary).toEqual(recentSummary.host_model_primary)
  expect(detail.host_model_primary).toEqual(projectSummary.host_model_primary)

  const exactMixItems = [detail, recentSummary, projectSummary].filter((item) => (
    Array.isArray(item?.host_model_mix)
  ))
  if (exactMixItems.length > 1) {
    assertExactHostModelMixParity(...exactMixItems)
  }

  assertHostModelRollupConsistency(detail, expectedHostModels)
}
