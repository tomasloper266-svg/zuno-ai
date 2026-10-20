import type { Conversation } from '../types'

/**
 * Local heuristic conversation titles — derived from the first user message
 * with no model call and no network: free-tier safe by construction.
 */

/** Titles cut at ~this many characters (code points), always on word boundaries. */
const MAX_TITLE_CHARS = 48
const ELLIPSIS = '…'

/**
 * Derive a conversation title from a user message: collapse whitespace, keep
 * whole words, and append an ellipsis when the text was cut. A word-boundary
 * cut can never break an RTL word — Arabic words are space-separated, so every
 * kept word stays whole. Length counts code points, not UTF-16 units, so
 * surrogate pairs (emoji, rare scripts) never split mid-character. Pure.
 *
 * Returns '' for empty/whitespace input — the caller keeps the existing title.
 */
export function deriveTitle(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text === '') return ''
  if ([...text].length <= MAX_TITLE_CHARS) return text

  // Greedy whole-word fill: keep adding words while the candidate fits.
  let cut = ''
  for (const word of text.split(' ')) {
    const candidate = cut === '' ? word : `${cut} ${word}`
    if ([...candidate].length > MAX_TITLE_CHARS) break
    cut = candidate
  }
  // One word longer than the cap cannot honor the boundary — cut it on code
  // points instead (still never splitting a surrogate pair).
  if (cut === '') cut = [...text].slice(0, MAX_TITLE_CHARS).join('')
  return `${cut}${ELLIPSIS}`
}

/**
 * Swap the creation-time provisional title for the heuristic one once the
 * first reply has committed. Conversations already finalized pass through
 * unchanged; conversations stored before `titleProvisional` existed have the
 * field undefined — treated as provisional, so their next completed reply
 * upgrades the title too. Pure.
 */
export function applyDerivedTitle(conv: Conversation): Conversation {
  if (conv.titleProvisional === false) return conv
  const firstUserMessage = conv.messages.find((m) => m.role === 'user')
  const derived = deriveTitle(firstUserMessage?.content ?? '')
  if (derived === '') return conv
  return { ...conv, title: derived, titleProvisional: false }
}
