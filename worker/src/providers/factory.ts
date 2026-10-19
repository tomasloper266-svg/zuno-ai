import type { Env } from "../env"
import type { ProviderAdapter } from "./types"
import { GeminiAdapter } from "./gemini"
import { OpenAIAdapter } from "./openai"

/**
 * Registry of wired providers. Switching provider is an env change
 * (AI_PROVIDER + AI_MODEL), never a frontend rewrite.
 */
const PROVIDERS: Record<string, () => ProviderAdapter> = {
  gemini: () => new GeminiAdapter(),
  openai: () => new OpenAIAdapter(),
}

export function resolveAdapter(env: Env): ProviderAdapter | null {
  const name = env.AI_PROVIDER ?? "gemini"
  const create = PROVIDERS[name]
  return create === undefined ? null : create()
}
