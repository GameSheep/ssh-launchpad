import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/shared/src/**/*.test.ts',
      'apps/server/src/**/*.test.ts',
      'apps/control-plane/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'apps/web/src/**/*.test.tsx',
    ],
    environmentMatchGlobs: [['apps/web/**', 'jsdom']],
    globals: false,
    passWithNoTests: false,
    restoreMocks: true,
    clearMocks: true,
  },
})
