import { afterEach, describe, expect, it, vi } from "vitest"
import { GeminiAdapter } from "../src/providers/gemini"
import { OpenAIAdapter } from "../src/providers/openai"
import { UpstreamError } from "../src/providers/types"
import type { Env } from "../src/env"
import type { AdapterInput, AdapterStream } from "../src/providers/types"

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

  it("sends temperature only when the input sets it (low for /title)", async () => {
    const withTemp = stubFetch({
      status: 200,
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "t" }] } }] }),
    })
    await new GeminiAdapter().generate({ ...input, temperature: 0.2 }, env)
    const tempBody = JSON.parse(withTemp.body) as { generationConfig: { temperature?: number } }
    expect(tempBody.generationConfig.temperature).toBe(0.2)

    const withoutTemp = stubFetch({
      status: 200,
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "t" }] } }] }),
    })
    await new GeminiAdapter().generate(input, env)
    const plainBody = JSON.parse(withoutTemp.body) as { generationConfig: { temperature?: number } }
    expect("temperature" in plainBody.generationConfig).toBe(false)
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

  it("omits temperature unless the input sets it (low for /title)", async () => {
    const withTemp = stubFetch({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "t" } }] }),
    })
    await new OpenAIAdapter().generate({ ...input, temperature: 0.2 }, env)
    const tempBody = JSON.parse(withTemp.body) as { temperature?: number }
    expect(tempBody.temperature).toBe(0.2)

    const withoutTemp = stubFetch({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "t" } }] }),
    })
    await new OpenAIAdapter().generate(input, env)
    const plainBody = JSON.parse(withoutTemp.body) as { temperature?: number }
    expect("temperature" in plainBody).toBe(false)
  })
})

/** ---------- streaming adapters (mocked SSE upstream) ---------- */

interface StreamCaptured {
  url: string
  headers: Record<string, string>
  body: string
  signal: AbortSignal | undefined
}

type RecordingStreamFetch = (
  input: unknown,
  init?: { headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Response>

function stubSseFetch(sseBody: string, init?: { status?: number; headers?: Record<string, string> }): StreamCaptured {
  const captured: StreamCaptured = { url: "", headers: {}, body: "", signal: undefined }
  const stub: RecordingStreamFetch = async (input, requestInit) => {
    captured.url = String(input)
    captured.headers = requestInit?.headers ?? {}
    captured.body = requestInit?.body ?? ""
    captured.signal = requestInit?.signal
    return new Response(sseBody, { status: init?.status ?? 200, headers: init?.headers })
  }
  vi.stubGlobal("fetch", stub)
  return captured
}

/** Drain every text delta the adapter stream yields, in arrival order. */
async function collectDeltas(stream: AdapterStream): Promise<string[]> {
  const texts: string[] = []
  for await (const text of stream.deltas) texts.push(text)
  return texts
}

/** A Gemini SSE body: text chunks then a final no-text finishReason chunk. */
function geminiSse(...texts: string[]): string {
  return (
    texts
      .map((text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\r\n\r\n`)
      .join("") + `data: ${JSON.stringify({ candidates: [{ finishReason: "stop" }] })}\r\n\r\n`
  )
}

function openaiSse(...texts: string[]): string {
  return (
    texts
      .map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
      .join("") + "data: [DONE]\n\n"
  )
}

describe("gemini streaming adapter", () => {
  it("posts to streamGenerateContent?alt=sse and yields chunk texts in order", async () => {
    const captured = stubSseFetch(geminiSse("مرحبا", " — ", "hi!"))

    const stream = await new GeminiAdapter().stream(input, env)

    expect(await collectDeltas(stream)).toEqual(["مرحبا", " — ", "hi!"])
    expect(stream.upstreamStatus).toBe(200)
    expect(captured.url).toBe(
      "https://gemini.mock.test/v1beta/models/gemini-test:streamGenerateContent?alt=sse",
    )
    expect(captured.headers["x-goog-api-key"]).toBe("test-key")
    // Same payload shape as the one-shot endpoint.
    const body = JSON.parse(captured.body) as { systemInstruction: unknown; contents: unknown[] }
    expect(body.systemInstruction).toBeDefined()
    expect(body.contents).toHaveLength(3)
  })

  it("tolerates CRLF framing, : comments, and chunks with no text", async () => {
    const body =
      ": keep-alive\r\n\r\n" +
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "a" }] } }] })}\r\n\r\n` +
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "b" }] } }] })}\r\n\r\n` +
      `data: ${JSON.stringify({ candidates: [{ finishReason: "stop" }] })}\r\n\r\n`
    stubSseFetch(body)

    const stream = await new GeminiAdapter().stream(input, env)

    expect(await collectDeltas(stream)).toEqual(["a", "b"])
  })

  it("passes the caller's abort signal to the upstream fetch", async () => {
    const captured = stubSseFetch(geminiSse("x"))
    const controller = new AbortController()

    await new GeminiAdapter().stream(input, env, controller.signal)

    expect(captured.signal).toBe(controller.signal)
  })

  it("maps a pre-flight provider rejection to an UpstreamError before any delta", async () => {
    stubSseFetch("upstream secret body", { status: 429, headers: { "Retry-After": "7" } })

    const error = await new GeminiAdapter()
      .stream(input, env)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(UpstreamError)
    expect((error as UpstreamError).code).toBe("rate_limited")
    expect((error as UpstreamError).retryAfterSeconds).toBe(7)
    expect((error as UpstreamError).message).not.toContain("upstream secret body")
  })

  it("raises upstream_error on a malformed mid-stream chunk", async () => {
    stubSseFetch(geminiSse("partial") + "data: {broken\n\n")

    const stream = await new GeminiAdapter().stream(input, env)
    expect((await stream.deltas.next()).value).toBe("partial")

    const error = await stream.deltas.next().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UpstreamError)
    expect((error as UpstreamError).code).toBe("upstream_error")
  })

  it("requires AI_API_KEY and AI_MODEL for streaming too", async () => {
    const error = await new GeminiAdapter()
      .stream(input, { ...env, AI_API_KEY: undefined })
      .catch((e: unknown) => e)
    expect((error as UpstreamError).code).toBe("config_error")
  })
})

describe("openai streaming adapter", () => {
  it("sets stream:true, yields delta contents in order, and stops at [DONE]", async () => {
    const captured = stubSseFetch(openaiSse("Hel", "lo"))

    const stream = await new OpenAIAdapter().stream(input, env)

    expect(await collectDeltas(stream)).toEqual(["Hel", "lo"])
    expect(captured.url).toBe("https://gemini.mock.test/chat/completions")
    expect(captured.headers["Authorization"]).toBe("Bearer test-key")
    const body = JSON.parse(captured.body) as { stream: boolean; model: string }
    expect(body.stream).toBe(true)
    expect(body.model).toBe("gemini-test")
  })

  it("keeps the one-shot request free of the stream flag", async () => {
    const captured = stubFetch({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "x" } }] }),
    })
    await new OpenAIAdapter().generate(input, env)
    const body = JSON.parse(captured.body) as { stream?: unknown }
    expect("stream" in body).toBe(false)
  })

  it("maps a pre-flight 401 (bad key) to config_error", async () => {
    stubSseFetch("bad key", { status: 401 })
    const error = await new OpenAIAdapter()
      .stream(input, env)
      .catch((e: unknown) => e)
    expect((error as UpstreamError).code).toBe("config_error")
  })

  it("requires AI_API_KEY and AI_MODEL for streaming too", async () => {
    const error = await new OpenAIAdapter()
      .stream(input, { ...env, AI_MODEL: undefined })
      .catch((e: unknown) => e)
    expect((error as UpstreamError).code).toBe("config_error")
  })
})
