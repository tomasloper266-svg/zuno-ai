import type { Env } from "../env"
import { UpstreamError } from "./types"
import { extractReply, postJsonToProvider } from "./request"
import type { AdapterInput, AdapterSuccess, ProviderAdapter } from "./types"

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
}

/**
 * Google Gemini (generativelanguage.googleapis.com generateContent).
 * System instruction stays server-side; assistant turns map to role "model".
 */
export class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini"

  async generate(input: AdapterInput, env: Env): Promise<AdapterSuccess> {
    const { apiKey, url } = geminiConfig(env)
    const response = await postJsonToProvider(
      url,
      { "x-goog-api-key": apiKey },
      {
        systemInstruction: { parts: [{ text: input.system }] },
        contents: input.turns.map((turn) => ({
          role: turn.role === "assistant" ? "model" : "user",
          parts: [{ text: turn.content }],
        })),
        generationConfig: { maxOutputTokens: input.maxOutputTokens },
      },
    )

    return extractReply(response, "gemini", (raw) => {
      const data = raw as GeminiResponse
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("")
      return text.length > 0 ? text : null
    })
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
