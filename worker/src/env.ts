/**
 * Bindings and configuration for the ZUNO chat-proxy Worker.
 *
 * AI_API_KEY is a secret injected by the runtime (`wrangler secret put` /
 * `.dev.vars` locally) — it is never committed. Everything else is
 * non-secret config from wrangler.toml [vars].
 */
export interface Env {
  /** D1 binding for per-IP rate-limit counters. */
  DB: D1Database
  /** Provider API key (Gemini API key or OpenAI-compatible key). */
  AI_API_KEY?: string
  /** Which adapter to use: "gemini" (default) | "openai". */
  AI_PROVIDER?: string
  /** Provider model id, e.g. "gemini-3.5-flash-lite" (pinned stable model). */
  AI_MODEL?: string
  /** Optional provider base-URL override (used by tests; defaults to the real endpoint). */
  AI_BASE_URL?: string
  /** Comma-separated exact-origin allow-list for CORS. */
  ALLOWED_ORIGINS?: string
}
