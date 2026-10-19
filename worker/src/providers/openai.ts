import type { Env } from "../env"
import { UpstreamError } from "./types"
import { extractReply, postJsonToProvider } from "./request"
import type { AdapterInput, AdapterSuccess, ProviderAdapter } from "./types"

const DEFAULT_BASE_URL = "https://api.openai.com/v1"

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>
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

  async generate(input: AdapterInput, env: Env): Promise<AdapterSuccess> {
    if (!env.AI_API_KEY || !env.AI_MODEL) {
      throw new UpstreamError("config_error", "openai adapter requires AI_API_KEY and AI_MODEL", {
        status: 500,
      })
    }
    const base = (env.AI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    const response = await postJsonToProvider(
      `${base}/chat/completions`,
      { Authorization: `Bearer ${env.AI_API_KEY}` },
      {
        model: env.AI_MODEL,
        messages: [
          { role: "system", content: input.system },
          ...input.turns.map((turn) => ({ role: turn.role, content: turn.content })),
        ],
        max_tokens: input.maxOutputTokens,
      },
    )

    return extractReply(response, "openai", (raw) => {
      const data = raw as OpenAIResponse
      const text = data.choices?.[0]?.message?.content ?? ""
      return text.length > 0 ? text : null
    })
  }
}
