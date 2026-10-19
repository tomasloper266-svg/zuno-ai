import { beforeEach } from "vitest"
import { env } from "cloudflare:test"

/**
 * DDL for the rate-limit table, applied to the local D1 before every test.
 * Keep in sync with migrations/0001_rate_limits.sql (deploy-time schema).
 */
export const RATE_LIMIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  ip_hash TEXT NOT NULL,
  window TEXT NOT NULL CHECK (window IN ('minute', 'day')),
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, window)
);
`

/**
 * Fresh table per test — vitest-pool-workers isolates storage between tests,
 * so this runs on an empty D1 every time. Call it at the top of files that
 * touch the DB.
 */
export function resetDb(): void {
  beforeEach(async () => {
    await env.DB.exec(RATE_LIMIT_SCHEMA)
  })
}

/** Env for tests that exercise adapters/endpoints but never touch D1. */
export function testEnv(overrides: Partial<import("../src/env").Env> = {}): import("../src/env").Env {
  return { DB: env.DB, AI_PROVIDER: "gemini", ...overrides }
}
