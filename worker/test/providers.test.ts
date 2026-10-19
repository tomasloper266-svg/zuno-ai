import { afterEach, describe, expect, it, vi } from "vitest"
import { GeminiAdapter } from "../src/providers/gemini"
import { OpenAIAdapter } from "../src/providers/openai"
import { UpstreamError } from "../src/providers/types"
import type { Env } from "../src/env"
import type { AdapterInput } from "../src/providers/types"

/**
 * Adapter mapping tests with a recorded fetch stub — no network access.
 * A separate suite (chat contract) covers the same mappings through the
 * deployed worker route with miniflare's outbound fetchMock.
 */

interface Captured {
  url: string
  headers: Record<string, string>
  body: string
}

type RecordingFetch = (
  input: unknown,
  init?: { headers?: Record<string, string>; body?: string },
) => Promise<Response>

function stubFetch(reply: { status: number; body: string; headers?: Record<string, string> }): Captured {
  const captured: Captured = { url: "", headers: {}, body: "" }
  const stub: RecordingFetch = async (input, init) => {
    captured.url = String(input)
    captured.headers = init?.headers ?? {}
    captured.body = init?.body ?? ""
    return new Response(reply.body, { status: reply.status, headers: reply.headers })
  }
  vi.stubGlobal("fetch", stub)
  return captured
}

const env: Env = {
  DB: undefined as unknown as Env["DB"], // adapters never touch D1
  AI_API_KEY: "test-key",
  AI_MODEL: "gemini-test",
  AI_BASE_URL: "https://gemini.mock.test",
}

const input: AdapterInput = {
  system: "SYS",
  turns: [
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer" },
    { role: "user", content: "Follow-up" },
  ],
  maxOutputTokens: 1024,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("gemini adapter", () => {
  it("maps turns to generateContent and joins part text into the reply", async () => {
    const captured = stubFetch({
      status: 200,
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: "مرحبا" }, { text: " — hi!" }] } }],
      }),
    })

    const result = await new GeminiAdapter().generate(input, env)

    expect(result.reply).toBe("مرحبا — hi!")
    expect(result.upstreamStatus).toBe(200)
    expect(captured.url).toBe(
      "https://gemini.mock.test/v1beta/models/gemini-test:generateContent",
    )
    expect(captured.headers["x-goog-api-key"]).toBe("test-key")

    const body = JSON.parse(captured.body) as {
      systemInstruction: { parts: { text: string }[] }
      contents: { role: string; parts: { text: string }[] }[]
      generationConfig: { maxOutputTokens: number }
    }
    expect(body.systemInstruction.parts[0]?.text).toBe("SYS")
    expect(body.generationConfig.maxOutputTokens).toBe(1024)
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "First question" }] },
      { role: "model", parts: [{ text: "First answer" }] },
      { role: "user", parts: [{ text: "Follow-up" }] },
    ])
  })

  it("maps upstream 429 to rate_limited", async () => {
    stubFetch({ status: 429, body: "upstream secret body", headers: { "Retry-After": "7" } })
    const error = await new GeminiAdapter()
      .generate(input, env)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UpstreamError)
    const upstream = error as UpstreamError
    expect(upstream.code).toBe("rate_limited")
    expect(upstream.status).toBe(429)
    expect(upstream.retryAfterSeconds).toBe(7)
    expect(upstream.message).not.toContain("upstream secret body")
  })

  it("maps upstream 500 to upstream_error", async () => {
    stubFetch({ status: 500, body: "upstream secret body" })
    const error = await new GeminiAdapter()
      .generate(input, env)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UpstreamError)
    const upstream = error as UpstreamError
    expect(upstream.code).toBe("upstream_error")
    expect(upstream.status).toBe(502)
    expect(upstream.upstreamStatus).toBe(500)
    expect(upstream.message).not.toContain("upstream secret body")
  })

  it("maps upstream 503 to over_capacity", async () => {
    stubFetch({ status: 503, body: "overloaded" })
    const error = await new GeminiAdapter()
      .generate(input, env)
      .catch((e: unknown) => e)
    expect((error as UpstreamError).code).toBe("over_capacity")
  })

  it("maps upstream 401 (bad key) to config_error", async () => {
    stubFetch({ status: 401, body: "invalid key" })
    const error = await new GeminiAdapter()
      .generate(input, env)
      .catch((e: unknown) => e)
    expect((error as UpstreamError).code).toBe("config_error")
    expect((error as UpstreamError).status).toBe(500)
  })

  it("maps a malformed success body to upstream_error without leaking it", async () => {
    stubFetch({ status: 200, body: "SECRET-UPSTREAM-ERROR-BODY" })
    const error = await new GeminiAdapter()
      .generate(input, env)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UpstreamError)
    expect((error as UpstreamError).code).toBe("upstream_error")
    expect((error as UpstreamError).message).not.toContain("SECRET-UPSTREAM-ERROR-BODY")
  })

  it("treats an empty candidates list as upstream_error", async () => {
    stubFetch({ status: 200, body: JSON.stringify({ candidates: [] }) })
    const error = await new GeminiAdapter()
      .generate(input, env)
      .catch((e: unknown) => e)
    expect((error as UpstreamError).code).toBe("upstream_error")
  })

  it("requires AI_API_KEY and AI_MODEL", async () => {
    const error = await new GeminiAdapter()
      .generate(input, { ...env, AI_API_KEY: undefined })
      .catch((e: unknown) => e)
    expect((error as UpstreamError).code).toBe("config_error")
  })
})

describe("openai-compatible adapter", () => {
  it("posts chat completions with a system message and bearer auth", async () => {
    const captured = stubFetch({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "Hello from the stub" } }] }),
    })

    const result = await new OpenAIAdapter().generate(input, env)

    expect(result.reply).toBe("Hello from the stub")
    expect(captured.url).toBe("https://gemini.mock.test/chat/completions")
    expect(captured.headers["Authorization"]).toBe("Bearer test-key")

    const body = JSON.parse(captured.body) as {
      model: string
      max_tokens: number
      messages: { role: string; content: string }[]
    }
    expect(body.model).toBe("gemini-test")
    expect(body.max_tokens).toBe(1024)
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Follow-up" },
    ])
  })

  it("maps failure statuses through the same envelope as gemini", async () => {
    stubFetch({ status: 429, body: "slow down" })
    const error = await new OpenAIAdapter()
      .generate(input, env)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UpstreamError)
    expect((error as UpstreamError).code).toBe("rate_limited")
  })
})
