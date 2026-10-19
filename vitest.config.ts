import { defineConfig } from 'vitest/config'

// Frontend unit tests only. worker/ tests run through worker/package.json —
// they need vitest-pool-workers and cloudflare:test, which root vitest can't provide.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
