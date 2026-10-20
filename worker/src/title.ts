import type { Env } from "./env"
import {
  errorResponse,
  jsonResponse,
  logEvent,
  upstreamErrorResponse,
} from "./http"
import { checkRateLimit, hashIp, titleLimiterKey } from "./ratelimit"
import { resolveAdapter } from "./providers/factory"
import type { AdapterInput } from "./providers/types"
import type { ChatTurn } from "./validate"

/**
 * POST /title — ChatGPT-style conversation titles.
 *
 * One strict provider call over the FIRST exchange (first user message plus
 * the first assistant reply, both client-truncated), returning a short title
 * in the user's language. The endpoint is intentionally boring: validate →
 * rate-limit (its own D1 bucket) → generate → sanitize → JSON. Every failure
 * is the standard { error: { code } } envelope; the client keeps its local
 * heuristic title on any failure, so nothing here is worth retrying loudly.
 */

export const TITLE_LIMITS = {
  maxUserChars: 2000,
  maxAssistantChars: 1000,
  /** Hard cap on the raw request body, applied before parsing. */
  maxBodyBytes: 4096,
} as const

/** Titles must be short: a tiny output budget bounds cost and stops rambling. */
export const TITLE_MAX_OUTPUT_TOKENS = 24
/** Low temperature — the reply is a deterministic label, not creative prose. */
export const TITLE_TEMPERATURE = 0.2

const TITLE_SYSTEM_PROMPT = `You generate conversation titles for a chat app.
Reply with ONLY the title text, nothing else.
Rules:
- Summarize the topic of the conversation above.
- Use the SAME language as the user's first message: an Arabic message gets an Arabic title, an English message gets an English title.
- Between 3 and 6 words. Never more than 6.
- No quotation marks of any kind, no surrounding punctuation, no trailing period, no emoji.
- Never use prefixes like "Conversation about", "Discussion of", "محادثة عن" or "سؤال عن".`

const TITLE_REQUEST_TURN = "Write the conversation title now."

export const TITLE_LIMIT_MESSAGE_MAX_CHARS = 80

export type TitleValidationResult =
  | { ok: true; user: string; assistant: string | undefined }
  | { ok: false; reason: string }

/**
 * Strict validation of the POST /title body:
 *   { "user": string, "assistant"?: string }
 * Unknown fields are dropped; `assistant` is optional (a failed first reply
 * can still be titled from the question alone). Whitespace is trimmed once
 * here — later stages never see padding.
 */
export function validateTitleBody(raw: string): TitleValidationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: "body is not valid JSON" }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "body must be a JSON object" }
  }

  const user = (parsed as { user?: unknown }).user
  if (typeof user !== "string" || user.trim().length === 0) {
    return { ok: false, reason: "user must be a non-empty string" }
  }
  if (user.length > TITLE_LIMITS.maxUserChars) {
    return { ok: false, reason: `user must not exceed ${TITLE_LIMITS.maxUserChars} characters` }
  }

  const assistant = (parsed as { assistant?: unknown }).assistant
  if (assistant !== undefined && typeof assistant !== "string") {
    return { ok: false, reason: "assistant must be a string when present" }
  }
  if (typeof assistant === "string" && assistant.length > TITLE_LIMITS.maxAssistantChars) {
    return { ok: false, reason: `assistant must not exceed ${TITLE_LIMITS.maxAssistantChars} characters` }
  }

  return {
    ok: true,
    user: user.trim(),
    assistant: typeof assistant === "string" && assistant.trim().length > 0 ? assistant.trim() : undefined,
  }
}

/**
 * The thread the provider sees: the exchange, then one server-side instruction
 * turn so the thread always ends user-first and the model answers with the
 * title, not a reply to the user's question. The instruction turn is never
 * stored anywhere — it exists only inside this request.
 */
export function titleTurns(user: string, assistant: string | undefined): ChatTurn[] {
  const turns: ChatTurn[] = [{ role: "user", content: user }]
  if (assistant !== undefined) turns.push({ role: "assistant", content: assistant })
  turns.push({ role: "user", content: TITLE_REQUEST_TURN })
  return turns
}

/** Wrapping quote pairs the model may add around a title (both LTR and RTL forms). */
const QUOTE_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["\u201C", "\u201D"], // “ ”
  ["\u2018", "\u2019"], // ‘ ’
  ["\u00AB", "\u00BB"], // « »
  ["\u00BB", "\u00AB"], // » « (RTL flip)
  ["\u2039", "\u203A"], // ‹ ›
  ["\u201E", "\u201C"], // „ “
]

/**
 * Clean the model's reply into a displayable title: collapse whitespace, strip
 * wrapping quotes (one level, repeated for doubled pairs), strip trailing
 * sentence periods, and hard-cap at 80 code points cut on a word boundary
 * (Arabic words are space-separated, so a boundary cut never splits a word).
 * Pure. Empty reply → '' — the caller turns that into a provider failure.
 */
export function sanitizeTitle(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim()
  for (;;) {
    if ([...text].length < 2) break
    const first = text[0]
    const last = text[text.length - 1]
    if (!QUOTE_PAIRS.some(([open, close]) => first === open && last === close)) break
    text = text.slice(1, -1).trim()
  }
  text = text.replace(/[.。\u2026]+\s*$/u, "").trim()

  const chars = [...text]
  if (chars.length > TITLE_LIMIT_MESSAGE_MAX_CHARS) {
    const sliced = chars.slice(0, TITLE_LIMIT_MESSAGE_MAX_CHARS).join("")
    const lastSpace = sliced.lastIndexOf(" ")
    text = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced
  }
  return text.trim()
}

/**
 * POST /title pipeline — mirrors handleChat: cheap local checks first, the
 * provider call last; per-IP rate limit AFTER validation, BEFORE the provider.
 * The title bucket is keyed separately from /chat (titleLimiterKey), so title
 * traffic never consumes chat quota and vice versa.
 */
export async function handleTitle(
  request: Request,
  env: Env,
  requestId: string,
  allowedOrigin: string | null,
): Promise<Response> {
  const contentType = request.headers.get("Content-Type") ?? ""
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return invalid(requestId, "content-type must be application/json", allowedOrigin)
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > TITLE_LIMITS.maxBodyBytes) {
    return invalid(requestId, "body exceeds size cap", allowedOrigin)
  }

  const raw = await request.text()
  if (raw.length > TITLE_LIMITS.maxBodyBytes) {
    return invalid(requestId, "body exceeds size cap", allowedOrigin)
  }

  const result = validateTitleBody(raw)
  if (!result.ok) {
    return invalid(requestId, result.reason, allowedOrigin)
  }

  const ipHash = await hashIp(request.headers.get("CF-Connecting-IP") ?? "")
  const decision = await checkRateLimit(env.DB, await titleLimiterKey(ipHash), Date.now())
  if (!decision.allowed) {
    return errorResponse("rate_limited", {
      allowedOrigin,
      retryAfterSeconds: decision.retryAfterSeconds ?? 60,
    })
  }

  const adapter = resolveAdapter(env)
  if (adapter === null) {
    logEvent("error", "provider_unwired", {
      requestId,
      provider: env.AI_PROVIDER ?? "gemini",
    })
    return errorResponse("config_error", { allowedOrigin })
  }

  const input: AdapterInput = {
    system: TITLE_SYSTEM_PROMPT,
    turns: titleTurns(result.user, result.assistant),
    maxOutputTokens: TITLE_MAX_OUTPUT_TOKENS,
    temperature: TITLE_TEMPERATURE,
  }

  try {
    const success = await adapter.generate(input, env)
    const title = sanitizeTitle(success.reply)
    if (title === "") {
      // The provider answered with nothing usable — a provider failure, not an
      // empty success: the client keeps its local heuristic title either way.
      logEvent("error", "title_empty_reply", { requestId, adapter: adapter.name })
      return errorResponse("upstream_error", { allowedOrigin })
    }
    return jsonResponse({ title }, 200, allowedOrigin)
  } catch (error) {
    return upstreamErrorResponse(error, adapter, requestId, allowedOrigin)
  }
}

/** Invalid requests share one client-visible code; the reason is logged only. */
function invalid(requestId: string, reason: string, allowedOrigin: string | null): Response {
  logEvent("info", "invalid_request", { requestId, reason })
  return errorResponse("invalid_request", { allowedOrigin })
}
