/**
 * Smart conversation titles (ChatGPT-style) — one model call per conversation.
 *
 * Fired from src/views/Chat.tsx right after the FIRST exchange commits, with
 * the first user message and the first assistant reply (both truncated). This
 * is a silent feature by design: on ANY failure — network, timeout, cancel,
 * bad payload, rate limit — the local heuristic title (lib/title) stands and
 * nothing is shown to the user. `requestSmartTitle` therefore resolves with
 * the new title or null, never throws.
 */

import { API_BASE, IS_DEMO } from './engine'

export interface SmartTitleInput {
  /** The first user message of the conversation. */
  user: string
  /** The first assistant reply of the conversation. */
  assistant: string
}

/** The caller-side deadline: a slow title is worse than a fast fallback. */
export const SMART_TITLE_TIMEOUT_MS = 6000

/** Wire caps — must match the worker's TITLE_LIMITS (worker/src/title.ts). */
const MAX_USER_CHARS = 2000
const MAX_ASSISTANT_CHARS = 1000
/** Defensive client-side cap on a returned title (the worker bounds it too). */
const MAX_TITLE_CHARS = 80

/** The exact body POST /title expects: { user, assistant }, both truncated. */
export function buildTitleBody(input: SmartTitleInput): string {
  return JSON.stringify({
    user: input.user.slice(0, MAX_USER_CHARS),
    assistant: input.assistant.slice(0, MAX_ASSISTANT_CHARS),
  })
}

/** Wrapping quote pairs a model may add around a title (LTR and RTL forms). */
const QUOTE_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['\u201C', '\u201D'], // “ ”
  ['\u2018', '\u2019'], // ‘ ’
  ['\u00AB', '\u00BB'], // « »
  ['\u00BB', '\u00AB'], // » « (RTL flip)
]

/**
 * Defensively clean the worker's reply into a displayable title: collapse
 * whitespace, strip one level of wrapping quotes, strip trailing sentence
 * periods, and cap at 80 code points (never splitting a surrogate pair).
 * Pure; returns '' for anything that is not a usable string.
 */
export function sanitizeSmartTitle(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let text = raw.replace(/\s+/g, ' ').trim()
  for (;;) {
    if ([...text].length < 2) break
    const first = text[0]
    const last = text[text.length - 1]
    if (!QUOTE_PAIRS.some(([open, close]) => first === open && last === close)) break
    text = text.slice(1, -1).trim()
  }
  text = text.replace(/[.。\u2026]+\s*$/u, '').trim()
  const chars = [...text]
  if (chars.length > MAX_TITLE_CHARS) {
    const sliced = chars.slice(0, MAX_TITLE_CHARS).join('')
    const lastSpace = sliced.lastIndexOf(' ')
    text = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced
  }
  return text.trim()
}

/**
 * Ask the worker for a smart title. Resolves the sanitized title, or null when
 * the answer is "keep the local title": demo mode, offline, any non-OK
 * response, malformed payload, abort (conversation switch), or the 6s deadline.
 * Aborts compose: `signal` is the caller's cancel switch; the deadline lives
 * here. Same request pattern as the /chat calls in engine.ts.
 */
export async function requestSmartTitle(
  input: SmartTitleInput,
  signal: AbortSignal,
): Promise<string | null> {
  if (IS_DEMO) return null
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null
  if (signal.aborted) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SMART_TITLE_TIMEOUT_MS)
  const onExternalAbort = (): void => controller.abort()
  signal.addEventListener('abort', onExternalAbort, { once: true })
  try {
    const res = await fetch(`${API_BASE}/title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildTitleBody(input),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as { title?: unknown }
    return sanitizeSmartTitle(data.title) || null
  } catch {
    // Network failure, cancel, or deadline — the silent fallback IS the feature.
    return null
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onExternalAbort)
  }
}
