import { defineConfig } from 'vitest/config';

/** Bilan de la récupération (npm run audit) : à part des tests, il lit le réseau et prend du temps. */
export default defineConfig({
  test: {
    include: ['scripts/audit/*.audit.ts'],
    environment: 'node',
    testTimeout: 30 * 60 * 1000,
  },
});
