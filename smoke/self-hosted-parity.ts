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
  last_host?: string
  last_model_name?: string
}

export interface SessionListItemLike extends HostModelRollupLike {
  active_ms?: number
  changed_files_count?: number
  event_count?: number
  events?: number
  last_event_time?: string
  project_name?: string
  project_ref?: string
  session_id?: string
  wait_ms?: number
}

interface SessionListResponseLike {
  items: SessionListItemLike[]
  [key: string]: unknown
}

interface ProjectDetailLike extends HostModelRollupLike {
  event_count?: number
  events?: number
  project_name?: string
  project_ref?: string
  session_count?: number
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
    host: entry?.host ?? null,
    model_name: entry?.model_name ?? null,
  }
}

export function normalizeSessionListItemForParity(item: SessionListItemLike | undefined) {
  return {
    active_ms: item?.active_ms ?? null,
    changed_files_count: item?.changed_files_count ?? null,
    event_count: getEventCount(item),
    host: getPrimaryHost(item),
    host_model_mix_count: item?.host_model_mix_count ?? null,
    host_model_primary: item?.host_model_primary ?? null,
    last_event_time: item?.last_event_time ?? null,
    last_model_name: item?.last_model_name ?? null,
    project_name: item?.project_name ?? null,
    project_ref: item?.project_ref ?? null,
    session_id: item?.session_id ?? null,
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
      expectedHostModels.map((entry) => normalizeHostModelExpectation(entry)),
    ))
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
  expect(getPrimaryHost(detail)).toBe(expectedHost)

  const recentEventCount = getEventCount(recentSummary)
  const projectEventCount = getEventCount(projectSummary)
  const detailEventCount = getEventCount(detail)
  expect(detailEventCount).toBe(recentEventCount)
  expect(detailEventCount).toBe(projectEventCount)

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

  assertHostModelRollupConsistency(detail, expectedHostModels)
}
