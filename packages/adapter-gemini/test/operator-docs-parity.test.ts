import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT_REPO_OPERATOR_DOCS_PARITY_TEST = new URL(
  '../../../test/docs/repo-operator-docs-parity.test.ts',
  import.meta.url,
)
const GEMINI_PACKAGE_DOCS_PARITY_TEST = new URL('./docs-parity.test.ts', import.meta.url)

describe('gemini repo-level docs ownership', () => {
  it('retires Gemini-held repo-level operator/docs parity in favor of a root-owned suite', () => {
    expect(existsSync(fileURLToPath(ROOT_REPO_OPERATOR_DOCS_PARITY_TEST))).toBe(true)
    expect(existsSync(fileURLToPath(GEMINI_PACKAGE_DOCS_PARITY_TEST))).toBe(true)

    const rootSuite = readFileSync(ROOT_REPO_OPERATOR_DOCS_PARITY_TEST, 'utf8')
    expect(rootSuite).toContain("describe('repo operator docs parity'")
  })
})
