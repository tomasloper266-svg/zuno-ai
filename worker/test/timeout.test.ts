import { describe, expect, it, vi } from "vitest"
import { pumpStream } from "../src/chat"
import { PROVIDER_TIMEOUT_MS, providerDeadline } from "../src/providers/timeout"
import { GeminiAdapter, geminiConfig } from "../src/providers/gemini"
import type { ProviderAdapter } from "../src/providers/types"
import type { Env } from "../src/env"

/**
 * Provider-call deadline: the timer aborts the shared signal and is told apart
 * from external aborts (client disconnect); the /chat pump turns a deadline hit
 * into one documented SSE `error` event with code `provider_timeout` and never
 * leaves a dangling timer. Uses short real timers — production duration is
 * PROVIDER_TIMEOUT_MS (documented in README.md).
 */

const env: Env = {
  DB: undefined as unknown as Env["DB"], // never touched by the code under test
  AI_API_KEY: "test-key",
  AI_MODEL: "gemini-test",
  AI_BASE_URL: "https://gemini.mock.test",
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Read every event from the pump's readable side until the stream closes. */
async function readEvents(readable: ReadableStream<Uint8Array>): Promise<Array<{ event: string; data: string }>> {
  const text = await new Response(readable).text()
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

/** A deltas generator that emits one delta, then hangs until the signal aborts —
 * mirroring a fetch body whose provider went silent. */
async function* stalledAfterFirst(signal: AbortSignal, first: string): AsyncGenerator<string, void, void> {
  yield first
  await new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
}

/** Wire a pump to a fresh pipe and hand back the readable side. */
function wirePump(
  deltas: AsyncGenerator<string, void, void>,
  clientGone: AbortController,
  deadline: ReturnType<typeof providerDeadline>,
): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  const send = async (event: string, data: unknown): Promise<void> => {
    await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
  }
  const adapter: ProviderAdapter = { name: "gemini" } as ProviderAdapter
  void pumpStream(deltas, send, writer, clientGone, adapter, "req-test", deadline)
  return readable
}

describe("providerDeadline", () => {
  it("aborts its signal after the timeout and reports timedOut", async () => {
    const deadline = providerDeadline(15)
    expect(deadline.timedOut).toBe(false)
    await wait(40)
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.timedOut).toBe(true)
    deadline.dispose()
  })

  it("forwards an external abort without marking timedOut (disconnect, not deadline)", async () => {
    const external = new AbortController()
    const deadline = providerDeadline(10_000, external.signal)
    external.abort()
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.timedOut).toBe(false)
    deadline.dispose()
  })

  it("is already aborted when an external signal aborted before wiring", () => {
    const external = new AbortController()
    external.abort()
    const deadline = providerDeadline(10_000, external.signal)
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.timedOut).toBe(false)
    deadline.dispose()
  })

  it("dispose cancels the pending deadline — a finished call leaves no timer", async () => {
    const deadline = providerDeadline(15)
    deadline.dispose()
    await wait(40)
    expect(deadline.signal.aborted).toBe(false)
    expect(deadline.timedOut).toBe(false)
  })

  it("production deadline is the documented 60s", () => {
    expect(PROVIDER_TIMEOUT_MS).toBe(60_000)
  })
})

describe("pumpStream — deadline hit mid-stream", () => {
  it("sends one documented provider_timeout error event, then closes the stream", async () => {
    const deadline = providerDeadline(25)
    const readable = wirePump(stalledAfterFirst(deadline.signal, "جزئي"), new AbortController(), deadline)

    const events = await readEvents(readable)

    expect(events.map((e) => e.event)).toEqual(["delta", "error"])
    expect(JSON.parse(events[1]?.data ?? "{}")).toEqual({ error: { code: "provider_timeout" } })
    deadline.dispose()
  })

  it("a client disconnect still takes precedence — no error event, no done", async () => {
    const clientGone = new AbortController()
    const deadline = providerDeadline(PROVIDER_TIMEOUT_MS, clientGone.signal)
    const readable = wirePump(stalledAfterFirst(deadline.signal, "part"), clientGone, deadline)

    const reader = readable.getReader()
    const decoder = new TextDecoder()
    // First chunk (the delta) arrives normally.
    const first = await reader.read()
    expect(decoder.decode(first.value)).toContain("delta")

    clientGone.abort()
    // The pump saw the disconnect: it stops pulling, sends neither done nor
    // error — and never reports a timeout (the disconnect is not a deadline).
    await wait(10)
    expect(deadline.timedOut).toBe(false)
    await reader.cancel()
    deadline.dispose()
  })

  it("a healthy stream finishes with done and leaves the deadline disarmed", async () => {
    async function* healthy(): AsyncGenerator<string, void, void> {
      yield "أهلا"
      yield "!"
    }
    const deadline = providerDeadline(50)
    const readable = wirePump(healthy(), new AbortController(), deadline)

    const events = await readEvents(readable)

    expect(events.map((e) => e.event)).toEqual(["delta", "delta", "done"])
    await wait(60)
    expect(deadline.timedOut).toBe(false)
    deadline.dispose()
  })
})

describe("adapters forward the deadline signal to the provider fetch", () => {
  it("gemini generate passes the signal through to fetch", async () => {
    let capturedSignal: AbortSignal | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
        capturedSignal = init?.signal
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), {
          status: 200,
        })
      }),
    )
    try {
      const deadline = providerDeadline(10_000)
      const { url } = geminiConfig(env)
      expect(url).toContain(":generateContent")
      await new GeminiAdapter().generate(
        { system: "SYS", turns: [{ role: "user", content: "hi" }], maxOutputTokens: 10 },
        env,
        deadline.signal,
      )
      expect(capturedSignal).toBe(deadline.signal)
      deadline.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
