import { describe, expect, it } from "vitest"
import { env } from "cloudflare:test"
import {
  checkRateLimit,
  DAY_LIMIT,
  dayWindowStart,
  hashIp,
  MINUTE_LIMIT,
  minuteWindowStart,
} from "../src/ratelimit"
import { resetDb } from "./schema"

resetDb()

const NOW_MS = Date.now()
const NOW_SECONDS = Math.floor(NOW_MS / 1000)

async function seedCounter(ipHash: string, window: "minute" | "day", windowStart: number, count: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO rate_limit_counters (ip_hash, window, window_start, count) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(ipHash, window, windowStart, count)
    .run()
}

describe("checkRateLimit", () => {
  it("allows the first 10 requests in a minute, then blocks with Retry-After", async () => {
    const ipHash = await hashIp("203.0.113.1")
    for (let i = 0; i < MINUTE_LIMIT; i++) {
      const decision = await checkRateLimit(env.DB, ipHash, NOW_MS)
      expect(decision.allowed).toBe(true)
      expect(decision.retryAfterSeconds).toBeNull()
    }
    const blocked = await checkRateLimit(env.DB, ipHash, NOW_MS)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).not.toBeNull()
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60)
  })

  it("keeps counting blocked requests so retry floods stay locked out", async () => {
    const ipHash = await hashIp("203.0.113.2")
    for (let i = 0; i <= MINUTE_LIMIT; i++) await checkRateLimit(env.DB, ipHash, NOW_MS)
    expect((await checkRateLimit(env.DB, ipHash, NOW_MS)).allowed).toBe(false)
    expect((await checkRateLimit(env.DB, ipHash, NOW_MS)).allowed).toBe(false)
  })

  it("counts each IP independently", async () => {
    const first = await hashIp("203.0.113.3")
    const second = await hashIp("203.0.113.4")
    for (let i = 0; i < MINUTE_LIMIT; i++) await checkRateLimit(env.DB, first, NOW_MS)
    const other = await checkRateLimit(env.DB, second, NOW_MS)
    expect(other.allowed).toBe(true)
  })

  it("resets the minute counter when the window rolls over", async () => {
    const ipHash = await hashIp("203.0.113.5")
    const pastMinute = minuteWindowStart(NOW_SECONDS) - 60
    await seedCounter(ipHash, "minute", pastMinute, 99)

    const decision = await checkRateLimit(env.DB, ipHash, NOW_MS)
    expect(decision.allowed).toBe(true)

    // Counter restarted: exhausting the fresh window takes 9 more requests.
    for (let i = 1; i < MINUTE_LIMIT; i++) {
      await checkRateLimit(env.DB, ipHash, NOW_MS)
    }
    expect((await checkRateLimit(env.DB, ipHash, NOW_MS)).allowed).toBe(false)
  })

  it("resets the day counter when the UTC day rolls over", async () => {
    const ipHash = await hashIp("203.0.113.6")
    const pastDay = dayWindowStart(NOW_SECONDS) - 86400
    await seedCounter(ipHash, "day", pastDay, DAY_LIMIT)

    expect((await checkRateLimit(env.DB, ipHash, NOW_MS)).allowed).toBe(true)
  })

  it("blocks after 60 requests in a day and reports seconds to UTC midnight", async () => {
    const ipHash = await hashIp("203.0.113.7")
    // Seed the day counter at the limit: a live run cannot reach a day block
    // without tripping the minute block first, since both windows count up
    // together on every request.
    await seedCounter(ipHash, "day", dayWindowStart(NOW_SECONDS), DAY_LIMIT)

    const blocked = await checkRateLimit(env.DB, ipHash, NOW_MS)
    expect(blocked.allowed).toBe(false)
    const expected = dayWindowStart(NOW_SECONDS) + 86400 - NOW_SECONDS
    expect(blocked.retryAfterSeconds).toBe(expected)
  })

  it("stores only hex SHA-256 hashes — never the raw IP", async () => {
    const ipHash = await hashIp("203.0.113.8")
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/)

    await checkRateLimit(env.DB, ipHash, NOW_MS)
    const rows = await env.DB.prepare("SELECT ip_hash, window FROM rate_limit_counters").all()
    expect(rows.results.length).toBeGreaterThan(0)
    for (const row of rows.results as Array<{ ip_hash: string }>) {
      expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
