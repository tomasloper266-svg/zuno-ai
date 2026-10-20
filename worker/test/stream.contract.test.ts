import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { SELF, fetchMock } from "cloudflare:test"
import { resetDb } from "./schema"

/**
 * Contract test of POST /chat streaming through the deployed worker (SELF),
 * with the provider's outbound SSE calls mocked by miniflare's fetchMock.
 * Asserts the SSE wire shape:
 *   POST { messages, stream: true }  →  200 text/event-stream
 *   event: delta {text} … event: done {reason:"stop"}
 * Every failure BEFORE the stream starts stays a JSON { error: { code } }.
 */

const UPSTREAM = "https://gemini.mock.test"
const STREAM_PATH = "/v1beta/models/gemini-test:streamGenerateContent?alt=sse"
const JSON_PATH = "/v1beta/models/gemini-test:generateContent"
const ALLOWED = "https://app.example.test"

const STREAM_BODY = JSON.stringify({
  messages: [{ role: "user", content: "Hello ZUNO" }],
  stream: true,
})

beforeAll(() => {
  fetchMock.activate()
  fetchMock.disableNetConnect()
})

afterEach(() => {
  fetchMock.assertNoPendingInterceptors()
})

resetDb()

function mockStreamEndpoint(status: number, body: string, headers?: Record<string, string>): void {
  fetchMock
    .get(UPSTREAM)
    .intercept({ method: "POST", path: STREAM_PATH })
    .reply(status, body, headers ? { headers } : undefined)
}

/** A Gemini SSE body: text chunks, then a final chunk that only carries finishReason. */
function geminiSse(...texts: string[]): string {
  return (
    texts
      .map((text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`)
      .join("") + `data: ${JSON.stringify({ candidates: [{ finishReason: "stop" }] })}\n\n`
  )
}

interface SseEvent {
  event: string
  data: string
}

async function readEvents(res: Response): Promise<SseEvent[]> {
  expect(res.headers.get("Content-Type")).toContain("text/event-stream")
  const text = await res.text()
  return text
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      let event = "message"
      let data = ""
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice("event:".length).trim()
        else if (line.startsWith("data:")) data = line.slice("data:".length).trim()
      }
      return { event, data }
    })
}

function chatRequest(overrides: Partial<{ body: string; ip: string; origin: string | null }> = {}): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "CF-Connecting-IP": overrides.ip ?? "203.0.113.30",
  }
  if (overrides.origin !== null) headers["Origin"] = overrides.origin ?? ALLOWED
  return new Request("https://worker.test/chat", {
    method: "POST",
    headers,
    body: overrides.body ?? STREAM_BODY,
  })
}

describe("POST /chat — streaming contract", () => {
  it("streams deltas then done for stream:true, with CORS headers", async () => {
    mockStreamEndpoint(200, geminiSse("مرحبا", " — ", "hi!"))

    const res = await SELF.fetch(chatRequest())

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/event-stream")
    expect(res.headers.get("Cache-Control")).toBe("no-cache")
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED)

    const events = await readEvents(res)
    expect(events.map((e) => e.event)).toEqual(["delta", "delta", "delta", "done"])
    expect(
      events
        .filter((e) => e.event === "delta")
        .map((e) => (JSON.parse(e.data) as { text?: string }).text),
    ).toEqual(["مرحبا", " — ", "hi!"])
    expect(events.at(-1)?.data).toBe(JSON.stringify({ reason: "stop" }))
  })

  it("works without an Origin header (non-browser client)", async () => {
    mockStreamEndpoint(200, geminiSse("ok"))
    const res = await SELF.fetch(chatRequest({ origin: null, ip: "203.0.113.31" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
    const events = await readEvents(res)
    expect(events.at(-1)?.event).toBe("done")
  })

  it("rejects an invalid body with JSON before any stream starts", async () => {
    const res = await SELF.fetch(
      chatRequest({ body: JSON.stringify({ messages: "nope", stream: true }), ip: "203.0.113.32" }),
    )
    expect(res.status).toBe(400)
    expect(res.headers.get("Content-Type")).toContain("application/json")
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("rejects a non-boolean stream flag with JSON before any stream starts", async () => {
    const res = await SELF.fetch(
      chatRequest({
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], stream: "yes" }),
        ip: "203.0.113.33",
      }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("maps a provider pre-flight rejection to a JSON error, not an SSE stream", async () => {
    mockStreamEndpoint(429, "provider busy", { "Retry-After": "9" })

    const res = await SELF.fetch(chatRequest({ ip: "203.0.113.34" }))

    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("9")
    expect(res.headers.get("Content-Type")).toContain("application/json")
    const body = await res.text()
    expect(body).not.toContain("provider busy")
    expect(JSON.parse(body)).toEqual({ error: { code: "rate_limited" } })
  })

  it("reports a mid-stream failure as an SSE error event and closes (no done)", async () => {
    mockStreamEndpoint(200, geminiSse("partial") + "data: {broken\n\n")

    const res = await SELF.fetch(chatRequest({ ip: "203.0.113.35" }))

    const events = await readEvents(res)
    expect(events.map((e) => e.event)).toEqual(["delta", "error"])
    expect(JSON.parse(events[0]?.data ?? "{}")).toEqual({ text: "partial" })
    expect(JSON.parse(events[1]?.data ?? "{}")).toEqual({ error: { code: "upstream_error" } })
  })

  it("rate-limits streaming requests like JSON ones, before any SSE", async () => {
    fetchMock
      .get(UPSTREAM)
      .intercept({ method: "POST", path: STREAM_PATH })
      .reply(200, geminiSse("ok"))
      .times(10)

    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch(chatRequest({ ip: "198.51.100.40" }))
      expect(res.status).toBe(200)
    }

    const blocked = await SELF.fetch(chatRequest({ ip: "198.51.100.40" }))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("Retry-After")).toBeTruthy()
    expect(await blocked.json()).toEqual({ error: { code: "rate_limited" } })
  })

  it("stream:false keeps the one-shot JSON contract", async () => {
    fetchMock
      .get(UPSTREAM)
      .intercept({ method: "POST", path: JSON_PATH })
      .reply(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: "reply text" }] } }] }))

    const res = await SELF.fetch(
      chatRequest({
        body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }], stream: false }),
        ip: "203.0.113.41",
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("application/json")
    expect(await res.json()).toEqual({ reply: "reply text" })
  })
})
