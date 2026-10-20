import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { SELF, fetchMock } from "cloudflare:test"
import { resetDb } from "./schema"
import { LIMITS } from "../src/validate"

/**
 * Full contract test of POST /chat through the deployed worker (SELF),
 * with the provider's outbound calls mocked by miniflare's fetchMock.
 * Asserts the exact wire shape src/lib/engine.ts speaks:
 *   POST { body: { messages } }  →  200 { reply }
 */

const UPSTREAM = "https://gemini.mock.test"
const MODEL_PATH = "/v1beta/models/gemini-test:generateContent"
const ALLOWED = "https://app.example.test"
const SECRET_MARKER = "SECRET-UPSTREAM-BODY-42"

const VALID_BODY = JSON.stringify({
  messages: [
    { role: "user", content: "Hello ZUNO" },
    { role: "assistant", content: "Ahlan!" },
    { role: "user", content: "وش تعرف تسوي؟" },
  ],
})

beforeAll(() => {
  fetchMock.activate()
  fetchMock.disableNetConnect()
})

afterEach(() => {
  fetchMock.assertNoPendingInterceptors()
})

resetDb()

function mockGemini(status: number, body: string, headers?: Record<string, string>): void {
  fetchMock
    .get(UPSTREAM)
    .intercept({ method: "POST", path: MODEL_PATH })
    .reply(status, body, headers ? { headers } : undefined)
}

/** Exactly `count` successful provider replies — stricter than persist(): any
 * extra or missing provider call fails the test via assertNoPendingInterceptors. */
function mockGeminiTimes(count: number): void {
  fetchMock
    .get(UPSTREAM)
    .intercept({ method: "POST", path: MODEL_PATH })
    .reply(
      200,
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "reply text" }] } }] }),
    )
    .times(count)
}

function chatRequest(overrides: Partial<{ origin: string | null; body: string; ip: string; contentType: string | null }> = {}): Request {
  const headers: Record<string, string> = { "CF-Connecting-IP": overrides.ip ?? "203.0.113.10" }
  if (overrides.contentType !== null) headers["Content-Type"] = overrides.contentType ?? "application/json"
  if (overrides.origin !== null) headers["Origin"] = overrides.origin ?? ALLOWED
  return new Request("https://worker.test/chat", {
    method: "POST",
    headers,
    body: overrides.body ?? VALID_BODY,
  })
}

describe("POST /chat — contract", () => {
  it("returns 200 { reply } with CORS headers for a valid request", async () => {
    mockGemini(
      200,
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "مرحبا! " }, { text: "How can I help?" }] } }] }),
    )

    const res = await SELF.fetch(chatRequest())

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("application/json")
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED)
    expect(await res.json()).toEqual({ reply: "مرحبا! How can I help?" })
  })

  it("works without an Origin header (non-browser client)", async () => {
    mockGemini(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }))
    const res = await SELF.fetch(chatRequest({ origin: null }))
    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(await res.json()).toEqual({ reply: "ok" })
  })

  it("maps upstream 429 to our 429 rate_limited with Retry-After and no body leak", async () => {
    mockGemini(429, SECRET_MARKER, { "Retry-After": "7" })

    const res = await SELF.fetch(chatRequest())

    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("7")
    const body = await res.text()
    expect(body).not.toContain(SECRET_MARKER)
    expect(JSON.parse(body)).toEqual({ error: { code: "rate_limited" } })
  })

  it("maps upstream 500 to upstream_error and never leaks the body", async () => {
    mockGemini(500, SECRET_MARKER)

    const res = await SELF.fetch(chatRequest())

    expect(res.status).toBe(502)
    const body = await res.text()
    expect(body).not.toContain(SECRET_MARKER)
    expect(JSON.parse(body)).toEqual({ error: { code: "upstream_error" } })
  })

  it("maps upstream 503 to over_capacity", async () => {
    mockGemini(503, SECRET_MARKER)
    const res = await SELF.fetch(chatRequest())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: { code: "over_capacity" } })
  })

  it("maps a malformed upstream success body to upstream_error", async () => {
    mockGemini(200, SECRET_MARKER)
    const res = await SELF.fetch(chatRequest())
    expect(res.status).toBe(502)
    const body = await res.text()
    expect(body).not.toContain(SECRET_MARKER)
    expect(JSON.parse(body)).toEqual({ error: { code: "upstream_error" } })
  })

  it("rejects malformed requests before any provider call", async () => {
    const res = await SELF.fetch(chatRequest({ body: "{nope" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("rejects requests without JSON content-type", async () => {
    const res = await SELF.fetch(chatRequest({ contentType: "text/plain" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("accepts application/json with a charset suffix", async () => {
    mockGemini(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: "تمام" }] } }] }))
    const res = await SELF.fetch(
      chatRequest({ contentType: "application/json; charset=utf-8" }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reply: "تمام" })
  })

  it("rejects oversized single-message content", async () => {
    const body = JSON.stringify({
      messages: [{ role: "user", content: "a".repeat(4001) }],
    })
    const res = await SELF.fetch(chatRequest({ body }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("keeps CORS headers on validation errors and never leaks reasons", async () => {
    const res = await SELF.fetch(chatRequest({ body: "{oops" }))
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED)
    const payload = (await res.json()) as { error: { code: string } }
    expect(Object.keys(payload)).toEqual(["error"])
    expect(Object.keys(payload.error)).toEqual(["code"])
  })

  it("returns 429 with Retry-After once the per-minute limit is exceeded", async () => {
    mockGeminiTimes(11) // 10 valid + 1 from the other IP; no more

    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch(chatRequest({ ip: "198.51.100.7" }))
      expect(res.status).toBe(200)
    }

    const blocked = await SELF.fetch(chatRequest({ ip: "198.51.100.7" }))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("Retry-After")).toBeTruthy()
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(Number(blocked.headers.get("Retry-After"))).toBeLessThanOrEqual(60)
    expect(await blocked.json()).toEqual({ error: { code: "rate_limited" } })

    const otherIp = await SELF.fetch(chatRequest({ ip: "198.51.100.8" }))
    expect(otherIp.status).toBe(200)
  })

  it("consumes from the same counter regardless of request validity (per-IP, valid traffic only reaches the limiter)", async () => {
    mockGeminiTimes(10) // each valid request reaches the provider exactly once
    // 10 valid requests exhaust the window; the 11th valid one is blocked.
    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch(chatRequest({ ip: "198.51.100.9" }))
      expect(res.status).toBe(200)
    }
    const blocked = await SELF.fetch(chatRequest({ ip: "198.51.100.9" }))
    expect(blocked.status).toBe(429)
  })
})

describe("POST /chat — raw-body byte cap", () => {
  /** An ASCII body of exactly `n` bytes (byte math is char math for ASCII). */
  function bodyOfSize(n: number): string {
    const prefix = '{"messages":[{"role":"user","content":"'
    const suffix = '"}]}'
    return prefix + "a".repeat(n - prefix.length - suffix.length) + suffix
  }

  it("keeps the 32 KiB cap exact — a body one byte over is rejected before parsing", async () => {
    // No VALID body can reach this cap (message limits keep valid bodies near
    // 8 KiB) — it is a raw-size guard, so both boundary bodies end in the same
    // invalid_request envelope; the cap merely decides before parsing.
    const atCap = bodyOfSize(LIMITS.maxBodyBytes)
    expect(new TextEncoder().encode(atCap).length).toBe(LIMITS.maxBodyBytes)
    expect((await SELF.fetch(chatRequest({ body: atCap }))).status).toBe(400)

    const res = await SELF.fetch(chatRequest({ body: bodyOfSize(LIMITS.maxBodyBytes + 1) }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })
})
