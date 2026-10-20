import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { SELF, fetchMock } from "cloudflare:test"
import { resetDb } from "./schema"

/**
 * Full contract test of POST /title through the deployed worker (SELF),
 * with the provider's outbound calls mocked by miniflare's fetchMock.
 * Wire shape (mirrors src/lib/smartTitle.ts on the frontend):
 *   POST { body: { user, assistant? } }  →  200 { title }
 */

const UPSTREAM = "https://gemini.mock.test"
const MODEL_PATH = "/v1beta/models/gemini-test:generateContent"
const ALLOWED = "https://app.example.test"
const SECRET_MARKER = "SECRET-UPSTREAM-BODY-42"

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

/** Exactly `count` provider replies — stricter than persist(): any extra or
 * missing provider call fails via assertNoPendingInterceptors. */
function mockGeminiTimes(count: number): void {
  fetchMock
    .get(UPSTREAM)
    .intercept({ method: "POST", path: MODEL_PATH })
    .reply(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: "title text" }] } }] }))
    .times(count)
}

function geminiTextReply(text: string): string {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })
}

function titleRequest(
  overrides: Partial<{ origin: string | null; body: string; ip: string; contentType: string | null }> = {},
): Request {
  const headers: Record<string, string> = { "CF-Connecting-IP": overrides.ip ?? "203.0.113.10" }
  if (overrides.contentType !== null) headers["Content-Type"] = overrides.contentType ?? "application/json"
  if (overrides.origin !== null) headers["Origin"] = overrides.origin ?? ALLOWED
  return new Request("https://worker.test/title", {
    method: "POST",
    headers,
    body:
      overrides.body ??
      JSON.stringify({
        user: "How do I build a REST API?",
        assistant: "Start by picking a framework.",
      }),
  })
}

describe("POST /title — success path", () => {
  it("returns 200 { title } with CORS headers, stripping wrapping quotes and trailing periods", async () => {
    mockGemini(200, geminiTextReply('"Building a REST API."'))

    const res = await SELF.fetch(titleRequest())

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("application/json")
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED)
    expect(await res.json()).toEqual({ title: "Building a REST API" })
  })

  it("strips Arabic wrapping quotes («») the same way", async () => {
    mockGemini(200, geminiTextReply("«كيفية بناء واجهة برمجية»"))

    const res = await SELF.fetch(titleRequest())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ title: "كيفية بناء واجهة برمجية" })
  })

  it("works without an Origin header (non-browser client)", async () => {
    mockGemini(200, geminiTextReply("Cool project idea"))
    const res = await SELF.fetch(titleRequest({ origin: null }))
    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(await res.json()).toEqual({ title: "Cool project idea" })
  })
})

describe("POST /title — input validation (no provider call)", () => {
  it("rejects malformed JSON", async () => {
    const res = await SELF.fetch(titleRequest({ body: "{nope" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("rejects non-JSON content types", async () => {
    const res = await SELF.fetch(titleRequest({ contentType: "text/plain" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("rejects a missing or empty user message", async () => {
    for (const body of ["{}", JSON.stringify({ user: "" }), JSON.stringify({ user: "   " })]) {
      const res = await SELF.fetch(titleRequest({ body }))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
    }
  })

  it("rejects a non-string assistant field", async () => {
    const res = await SELF.fetch(titleRequest({ body: JSON.stringify({ user: "q", assistant: 5 }) }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("rejects an oversized user message", async () => {
    const body = JSON.stringify({ user: "a".repeat(2001) })
    const res = await SELF.fetch(titleRequest({ body }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("rejects an oversized assistant reply", async () => {
    const body = JSON.stringify({ user: "q", assistant: "a".repeat(1001) })
    const res = await SELF.fetch(titleRequest({ body }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("rejects a body over the hard byte cap before parsing", async () => {
    const res = await SELF.fetch(titleRequest({ body: `{"user":"${"a".repeat(4200)}"}` }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("keeps CORS headers on validation errors and never leaks reasons", async () => {
    const res = await SELF.fetch(titleRequest({ body: "{oops" }))
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED)
    const payload = (await res.json()) as { error: { code: string } }
    expect(Object.keys(payload)).toEqual(["error"])
    expect(Object.keys(payload.error)).toEqual(["code"])
  })

  it("rejects wrong methods and disallowed origins", async () => {
    const getRes = await SELF.fetch("https://worker.test/title", { method: "GET" })
    expect(getRes.status).toBe(405)
    expect(getRes.headers.get("Allow")).toContain("POST")
    expect(await getRes.json()).toEqual({ error: { code: "invalid_request" } })

    const forbidden = await SELF.fetch(titleRequest({ origin: "https://evil.test" }))
    expect(forbidden.status).toBe(403)
    expect(forbidden.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(await forbidden.json()).toEqual({ error: { code: "invalid_request" } })
  })
})

describe("POST /title — provider failure mapping", () => {
  it("maps upstream 500 to upstream_error and never leaks the body", async () => {
    mockGemini(500, SECRET_MARKER)

    const res = await SELF.fetch(titleRequest())

    expect(res.status).toBe(502)
    const body = await res.text()
    expect(body).not.toContain(SECRET_MARKER)
    expect(JSON.parse(body)).toEqual({ error: { code: "upstream_error" } })
  })

  it("maps upstream 429 to our 429 rate_limited with Retry-After", async () => {
    mockGemini(429, SECRET_MARKER, { "Retry-After": "9" })

    const res = await SELF.fetch(titleRequest())

    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("9")
    expect(await res.json()).toEqual({ error: { code: "rate_limited" } })
  })

  it("maps upstream 503 to over_capacity", async () => {
    mockGemini(503, SECRET_MARKER)
    const res = await SELF.fetch(titleRequest())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: { code: "over_capacity" } })
  })

  it("maps a malformed upstream success body to upstream_error", async () => {
    mockGemini(200, SECRET_MARKER)
    const res = await SELF.fetch(titleRequest())
    expect(res.status).toBe(502)
    expect(JSON.parse(await res.text())).toEqual({ error: { code: "upstream_error" } })
  })

  it("treats a whitespace-only or empty model reply as a provider failure", async () => {
    mockGemini(200, geminiTextReply("   "))
    const res = await SELF.fetch(titleRequest())
    expect(res.status).toBe(502)
    expect(JSON.parse(await res.text())).toEqual({ error: { code: "upstream_error" } })
  })
})

describe("POST /title — independent rate-limit bucket", () => {
  it("blocks the 11th title in a minute without touching the chat bucket", async () => {
    mockGeminiTimes(11) // 10 titles + 1 chat — every call accounted for

    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch(titleRequest({ ip: "198.51.100.7" }))
      expect(res.status).toBe(200)
    }

    const blocked = await SELF.fetch(titleRequest({ ip: "198.51.100.7" }))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("Retry-After")).toBeTruthy()
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(Number(blocked.headers.get("Retry-After"))).toBeLessThanOrEqual(60)
    expect(await blocked.json()).toEqual({ error: { code: "rate_limited" } })

    // The chat bucket for the SAME IP is untouched by title exhaustion.
    const chat = await SELF.fetch("https://worker.test/chat", {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "198.51.100.7",
        "Content-Type": "application/json",
        Origin: ALLOWED,
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    })
    expect(chat.status).toBe(200)
    expect(await chat.json()).toEqual({ reply: "title text" })
  })

  it("blocks the 11th chat in a minute without touching the title bucket", async () => {
    mockGeminiTimes(11) // 10 chats + 1 title

    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch("https://worker.test/chat", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "198.51.100.8",
          "Content-Type": "application/json",
          Origin: ALLOWED,
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      })
      expect(res.status).toBe(200)
    }

    const title = await SELF.fetch(titleRequest({ ip: "198.51.100.8" }))
    expect(title.status).toBe(200)
    expect(await title.json()).toEqual({ title: "title text" })
  })

  it("counts each IP independently", async () => {
    mockGeminiTimes(11)
    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch(titleRequest({ ip: "198.51.100.9" }))
      expect(res.status).toBe(200)
    }
    const blocked = await SELF.fetch(titleRequest({ ip: "198.51.100.9" }))
    expect(blocked.status).toBe(429)
    const otherIp = await SELF.fetch(titleRequest({ ip: "198.51.100.10" }))
    expect(otherIp.status).toBe(200)
  })
})
