/**
 * Strict validation for POST /chat bodies.
 *
 * The wire contract matches the frontend's `src/lib/engine.ts`:
 *   { messages: [{ role: "user" | "assistant", content: string }, ...],
 *     stream?: boolean }
 * Unknown fields are dropped — only clean { role, content } turns survive;
 * `stream` opts the response into SSE instead of a JSON body.
 */

export interface ChatTurn {
  role: "user" | "assistant"
  content: string
}

export const LIMITS = {
  minMessages: 1,
  maxMessages: 20,
  minContentChars: 1,
  maxContentChars: 4000,
  maxTotalChars: 8000,
  /** Hard cap on the raw request body, applied before parsing. */
  maxBodyBytes: 32768,
} as const

export type ValidationResult =
  | { ok: true; turns: ChatTurn[]; totalChars: number; stream: boolean }
  | { ok: false; reason: string }

export function validateChatBody(raw: string): ValidationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: "body is not valid JSON" }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "body must be a JSON object" }
  }

  const messages = (parsed as { messages?: unknown }).messages
  if (!Array.isArray(messages)) {
    return { ok: false, reason: "messages must be an array" }
  }

  // Optional SSE opt-in. Strict about the type: a truthy non-boolean is invalid,
  // so a client can never get a stream it did not exactly ask for.
  const stream = (parsed as { stream?: unknown }).stream
  if (stream !== undefined && typeof stream !== "boolean") {
    return { ok: false, reason: "stream must be a boolean" }
  }
  if (messages.length < LIMITS.minMessages || messages.length > LIMITS.maxMessages) {
    return {
      ok: false,
      reason: `messages must contain ${LIMITS.minMessages}-${LIMITS.maxMessages} items`,
    }
  }

  const turns: ChatTurn[] = []
  let totalChars = 0
  for (const entry of messages) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, reason: "each message must be an object" }
    }
    const { role, content } = entry as { role?: unknown; content?: unknown }
    if (role !== "user" && role !== "assistant") {
      return { ok: false, reason: 'role must be "user" or "assistant"' }
    }
    if (
      typeof content !== "string" ||
      content.length < LIMITS.minContentChars ||
      content.length > LIMITS.maxContentChars
    ) {
      return {
        ok: false,
        reason: `content must be a string of ${LIMITS.minContentChars}-${LIMITS.maxContentChars} characters`,
      }
    }
    totalChars += content.length
    if (totalChars > LIMITS.maxTotalChars) {
      return {
        ok: false,
        reason: `total content must not exceed ${LIMITS.maxTotalChars} characters`,
      }
    }
    // Rebuild the turn so unknown fields never reach the provider.
    turns.push({ role, content })
  }

  return { ok: true, turns, totalChars, stream: stream === true }
}
