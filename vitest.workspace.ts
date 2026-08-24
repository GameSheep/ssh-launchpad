import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    extends: './vitest.base.config.ts',
    test: {
      name: 'shared',
      include: ['packages/shared/src/**/*.test.ts'],
    },
  },
  {
    extends: './vitest.base.config.ts',
    test: {
      name: 'server',
      include: ['apps/server/src/**/*.test.ts'],
    },
  },
  {
    extends: './vitest.base.config.ts',
    test: {
      name: 'web',
      include: ['apps/web/src/**/*.test.ts', 'apps/web/src/**/*.test.tsx'],
      environment: 'jsdom',
    },
  },
])
