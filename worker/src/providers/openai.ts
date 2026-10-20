import type { Env } from "../env"
import { UpstreamError } from "./types"
import { extractReply, ensureStreamable, postJsonToProvider } from "./request"
import { parseSseChunk, sseDataEvents } from "./sse"
import type { AdapterInput, AdapterStream, AdapterSuccess, ProviderAdapter } from "./types"

const DEFAULT_BASE_URL = "https://api.openai.com/v1"

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>
}

interface OpenAIStreamResponse {
  choices?: Array<{ delta?: { content?: string } }>
}

/** Request payload shared by the one-shot and streaming endpoints. */
function openaiBody(input: AdapterInput, env: Env, stream: boolean): unknown {
  return {
    model: env.AI_MODEL,
    messages: [
      { role: "system", content: input.system },
      ...input.turns.map((turn) => ({ role: turn.role, content: turn.content })),
    ],
    max_tokens: input.maxOutputTokens,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(stream ? { stream: true } : {}),
  }
}

/** Pull text out of one streamed OpenAI chunk; null = nothing to emit. */
function openaiChunkText(data: string): string | null {
  const chunk = parseSseChunk(data, "openai") as OpenAIStreamResponse
  const text = chunk.choices?.[0]?.delta?.content ?? ""
  return text.length > 0 ? text : null
}

async function* openaiDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  for await (const data of sseDataEvents(body)) {
    if (data === "[DONE]") return // OpenAI's end-of-stream sentinel
    const text = openaiChunkText(data)
    if (text !== null) yield text
  }
}

/**
 * OpenAI-compatible chat completions stub (api.openai.com or any compatible
 * base URL). Implementing the same ProviderAdapter interface as Gemini, it
 * makes switching providers an env change (AI_PROVIDER=openai + AI_MODEL),
 * never a frontend rewrite. Not exercised against a live endpoint yet —
 * see README "Provider adapters".
 */
export class OpenAIAdapter implements ProviderAdapter {
  readonly name = "openai"

  async generate(input: AdapterInput, env: Env, signal?: AbortSignal): Promise<AdapterSuccess> {
    if (!env.AI_API_KEY || !env.AI_MODEL) {
      throw new UpstreamError("config_error", "openai adapter requires AI_API_KEY and AI_MODEL", {
        status: 500,
      })
    }
    const base = (env.AI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    const response = await postJsonToProvider(
      `${base}/chat/completions`,
      { Authorization: `Bearer ${env.AI_API_KEY}` },
      openaiBody(input, env, false),
      signal,
    )

    return extractReply(response, "openai", (raw) => {
      const data = raw as OpenAIResponse
      const text = data.choices?.[0]?.message?.content ?? ""
      return text.length > 0 ? text : null
    })
  }

  async stream(input: AdapterInput, env: Env, signal?: AbortSignal): Promise<AdapterStream> {
    if (!env.AI_API_KEY || !env.AI_MODEL) {
      throw new UpstreamError("config_error", "openai adapter requires AI_API_KEY and AI_MODEL", {
        status: 500,
      })
    }
    const base = (env.AI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    const response = await postJsonToProvider(
      `${base}/chat/completions`,
      { Authorization: `Bearer ${env.AI_API_KEY}` },
      openaiBody(input, env, true),
      signal,
    )
    const body = ensureStreamable(response, "openai")
    return { upstreamStatus: response.status, deltas: openaiDeltas(body) }
  }
}
