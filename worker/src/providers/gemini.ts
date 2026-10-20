import type { Env } from "../env"
import { UpstreamError } from "./types"
import { extractReply, ensureStreamable, postJsonToProvider } from "./request"
import { parseSseChunk, sseDataEvents } from "./sse"
import type { AdapterInput, AdapterStream, AdapterSuccess, ProviderAdapter } from "./types"

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
}

/** Request payload shared by the one-shot and streaming endpoints. */
function geminiBody(input: AdapterInput): unknown {
  return {
    systemInstruction: { parts: [{ text: input.system }] },
    contents: input.turns.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    generationConfig: {
      maxOutputTokens: input.maxOutputTokens,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    },
  }
}

/** Pull text out of one streamed Gemini chunk; null = nothing to emit. */
function geminiChunkText(data: string): string | null {
  const chunk = parseSseChunk(data, "gemini") as GeminiResponse
  const text = (chunk.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
  return text.length > 0 ? text : null
}

async function* geminiDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  for await (const data of sseDataEvents(body)) {
    const text = geminiChunkText(data)
    if (text !== null) yield text
  }
}

/**
 * Google Gemini (generativelanguage.googleapis.com generateContent).
 * System instruction stays server-side; assistant turns map to role "model".
 */
export class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini"

  async generate(input: AdapterInput, env: Env): Promise<AdapterSuccess> {
    const { apiKey, url } = geminiConfig(env)
    const response = await postJsonToProvider(url, { "x-goog-api-key": apiKey }, geminiBody(input))

    return extractReply(response, "gemini", (raw) => {
      const data = raw as GeminiResponse
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("")
      return text.length > 0 ? text : null
    })
  }

  async stream(input: AdapterInput, env: Env, signal?: AbortSignal): Promise<AdapterStream> {
    const { apiKey, url } = geminiConfig(env)
    // Same endpoint family, one-shot swapped for SSE streaming (alt=sse).
    const streamUrl = url.replace(/:generateContent$/, ":streamGenerateContent?alt=sse")
    const response = await postJsonToProvider(
      streamUrl,
      { "x-goog-api-key": apiKey },
      geminiBody(input),
      signal,
    )
    const body = ensureStreamable(response, "gemini")
    return { upstreamStatus: response.status, deltas: geminiDeltas(body) }
  }
}

export function geminiConfig(env: Env): { model: string; apiKey: string; url: string } {
  if (!env.AI_API_KEY || !env.AI_MODEL) {
    throw new UpstreamError("config_error", "gemini adapter requires AI_API_KEY and AI_MODEL", {
      status: 500,
    })
  }
  const base = (env.AI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  return {
    model: env.AI_MODEL,
    apiKey: env.AI_API_KEY,
    url: `${base}/v1beta/models/${encodeURIComponent(env.AI_MODEL)}:generateContent`,
  }
}
