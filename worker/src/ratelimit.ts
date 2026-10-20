/**
 * Per-IP rate limiting backed by D1.
 *
 * Counters are keyed by a SHA-256 hash of the client IP — the raw IP is never
 * stored. Two fixed windows are incremented on every request: a 1-minute and a
 * UTC-day window. Blocked requests are counted too, so retry floods stay
 * locked out until the window resets.
 */

export const MINUTE_LIMIT = 10
export const DAY_LIMIT = 60

const MINUTE_SECONDS = 60
const DAY_SECONDS = 86400

/** Start (epoch seconds) of the fixed 60s window containing `epochSeconds`. */
export function minuteWindowStart(epochSeconds: number): number {
  return Math.floor(epochSeconds / MINUTE_SECONDS) * MINUTE_SECONDS
}

/** Start (epoch seconds) of the UTC-day window containing `epochSeconds`. */
export function dayWindowStart(epochSeconds: number): number {
  return Math.floor(epochSeconds / DAY_SECONDS) * DAY_SECONDS
}

/** SHA-256 of the client IP as lowercase hex — the only IP form ever persisted. */
export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * Independent limiter key for the /title bucket, derived from the chat key.
 *
 * The D1 schema pins the `window` values with a CHECK constraint
 * ('minute' | 'day') and the deploy workflow applies no migrations, so buckets
 * are separated by namespacing the KEY instead of adding window names.
 * Re-hashing the already-hashed IP keeps every stored key a pure SHA-256 hex
 * digest — the raw IP is never stored in any form.
 */
export async function titleLimiterKey(ipHash: string): Promise<string> {
  return hashIp(`${ipHash}:title`)
}

export interface RateDecision {
  allowed: boolean
  /** Defined only when blocked: seconds until the binding window resets. */
  retryAfterSeconds: number | null
}

/**
 * Atomically increment both window counters for `ipHash` and decide.
 * One D1 batch (one round trip): two upserts that reset on window rollover,
 * then two reads of the fresh counts.
 */
export async function checkRateLimit(
  db: D1Database,
  ipHash: string,
  nowMs: number,
): Promise<RateDecision> {
  const nowSeconds = Math.floor(nowMs / 1000)
  const minuteStart = minuteWindowStart(nowSeconds)
  const dayStart = dayWindowStart(nowSeconds)

  const upsert = (window: string, windowStart: number): D1PreparedStatement =>
    db
      .prepare(
        `INSERT INTO rate_limit_counters (ip_hash, window, window_start, count)
         VALUES (?1, ?2, ?3, 1)
         ON CONFLICT (ip_hash, window) DO UPDATE SET
           count = CASE WHEN window_start = ?3 THEN count + 1 ELSE 1 END,
           window_start = ?3`,
      )
      .bind(ipHash, window, windowStart)

  const select = (window: string): D1PreparedStatement =>
    db
      .prepare("SELECT count FROM rate_limit_counters WHERE ip_hash = ?1 AND window = ?2")
      .bind(ipHash, window)

  const results = await db.batch([
    upsert("minute", minuteStart),
    upsert("day", dayStart),
    select("minute"),
    select("day"),
  ])

  const minuteCount = readCount(results[2])
  const dayCount = readCount(results[3])

  const minuteExceeded = minuteCount > MINUTE_LIMIT
  const dayExceeded = dayCount > DAY_LIMIT
  if (!minuteExceeded && !dayExceeded) {
    return { allowed: true, retryAfterSeconds: null }
  }

  let retryAfter = 0
  if (minuteExceeded) retryAfter = Math.max(retryAfter, minuteStart + MINUTE_SECONDS - nowSeconds)
  if (dayExceeded) retryAfter = Math.max(retryAfter, dayStart + DAY_SECONDS - nowSeconds)
  return { allowed: false, retryAfterSeconds: retryAfter }
}

function readCount(result: D1Result<unknown> | undefined): number {
  const row = result?.results?.[0] as { count?: unknown } | undefined
  return typeof row?.count === "number" ? row.count : 0
}
