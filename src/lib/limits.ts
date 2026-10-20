/**
 * Composer input limits, mirrored from the Worker's wire contract
 * (worker/src/validate.ts LIMITS.maxContentChars / maxTotalChars). The two
 * packages share no dependency, so the numbers are duplicated deliberately —
 * both sides' tests pin them.
 */
export const MAX_MESSAGE_CHARS = 4000
export const MAX_TOTAL_CHARS = 8000

/** Warning zone: one tenth of the limit or less remaining. Integer math —
 * `chars <= limit * (1 - 0.9)` breaks on floating-point (4000*0.1 < 400). */
const LIMIT_WARNING_DIVISOR = 10

export interface LimitStatus {
  /** Draft length after trim — what `send` would actually submit. */
  messageChars: number
  /** Request total the next send would produce: sent thread content + draft. */
  totalChars: number
  messageRemaining: number
  totalRemaining: number
  messageOver: boolean
  totalOver: boolean
  /** At or past 90% of either limit — the counter becomes visible and warning-colored. */
  nearLimit: boolean
}

/**
 * Pure composer-limit feedback. Counting mirrors the Worker exactly: UTF-16
 * code units of the trimmed content (`text.length`), never bytes — the Worker's
 * body-size byte check is a separate, coarser cap measured on the wire.
 */
export function limitStatus(draft: string, threadChars: number): LimitStatus {
  const messageChars = draft.trim().length
  const totalChars = threadChars + messageChars
  const messageRemaining = MAX_MESSAGE_CHARS - messageChars
  const totalRemaining = MAX_TOTAL_CHARS - totalChars
  return {
    messageChars,
    totalChars,
    messageRemaining,
    totalRemaining,
    messageOver: messageRemaining < 0,
    totalOver: totalRemaining < 0,
    nearLimit:
      messageRemaining * LIMIT_WARNING_DIVISOR <= MAX_MESSAGE_CHARS ||
      totalRemaining * LIMIT_WARNING_DIVISOR <= MAX_TOTAL_CHARS,
  }
}
