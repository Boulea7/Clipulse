import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@clipulse/collector-core': path.resolve(__dirname, 'packages/collector-core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/web/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
    },
  },
})
