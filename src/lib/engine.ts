/**
 * ZUNO chat engine.
 *
 * Demo mode (default): replies are scripted and always labeled as demo in the
 * UI — they are never presented as output of a live AI model.
 * Live mode (optional): set VITE_API_URL to a backend that accepts
 * POST /chat  { messages, stream? }  and answers either one-shot
 * { reply: string } or an SSE stream of delta/done/error events.
 */

import { sseEvents } from './sse'

export interface ThreadMessage {
  role: 'user' | 'assistant'
  content: string
}

const API_BASE = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '') ?? ''

export const IS_DEMO = API_BASE === ''

/** Why a chat request failed — drives which error banner the UI shows. */
export type ChatErrorKind = 'connection' | 'too_fast' | 'daily_limit' | 'service' | 'invalid'

/** How many of the newest thread messages ride on the wire to the chat API. */
export const SENT_MESSAGE_LIMIT = 20

/** The newest messages of a thread, in their original order — what a chat request
 * carries. Pure, and request-time only: the stored conversation history keeps
 * every message; trimming happens here, on the way out the door. */
export function recentMessagesForRequest(thread: ThreadMessage[]): {
  messages: ThreadMessage[]
  trimmed: boolean
} {
  return {
    messages: thread.slice(-SENT_MESSAGE_LIMIT),
    trimmed: thread.length > SENT_MESSAGE_LIMIT,
  }
}

/** A chat failure carrying the kind the banner UI keys on. */
export class ChatRequestError extends Error {
  readonly kind: ChatErrorKind
  constructor(kind: ChatErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ChatRequestError'
    this.kind = kind
  }
}

/** Retry-After at or below this marks a minute-scale burst limit, not an exhausted daily quota. */
const BURST_RETRY_AFTER_MAX_SECONDS = 120

/** How a streamed reply ended: normally, or cut short by the caller's abort. */
export type StreamOutcome = 'completed' | 'aborted'

/** Worker error bodies are always { error: { code } } — tolerate anything else (an intermediary may serve a non-JSON error page). */
async function readErrorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } }
    const code = body?.error?.code
    return typeof code === 'string' ? code : null
  } catch {
    // Unreadable body only means no code field; status-based classification below still applies.
    return null
  }
}

/** Map a non-OK response to the truthful failure kind: exhausted quota, burst limit,
 * a rejected (invalid) request, or a service fault. */
async function classifyFailure(res: Response): Promise<ChatRequestError> {
  const code = await readErrorCode(res)
  const retryAfter = Number.parseInt(res.headers.get('Retry-After') ?? '', 10)
  const burstWindow =
    Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= BURST_RETRY_AFTER_MAX_SECONDS
  if (code === 'rate_limited' || res.status === 429) {
    const detail = `status ${res.status}, code ${code ?? 'unknown'}, retry-after ${Number.isFinite(retryAfter) ? retryAfter : 'none'}`
    return new ChatRequestError(
      burstWindow ? 'too_fast' : 'daily_limit',
      `Chat API rate-limited the request (${detail})`,
    )
  }
  // A 400 — with or without the Worker's { error: { code } } body — means the request
  // itself was rejected (e.g. a message too long), not that the service is down.
  if (code === 'invalid_request' || res.status === 400) {
    return new ChatRequestError(
      'invalid',
      `Chat API rejected the request as invalid (status ${res.status}, code ${code ?? 'unknown'})`,
    )
  }
  return new ChatRequestError('service', `Chat API responded with status ${res.status} (code ${code ?? 'unknown'})`)
}

export async function getAssistantReply(thread: ThreadMessage[]): Promise<string> {
  if (!IS_DEMO) {
    let res: Response
    try {
      res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: thread }),
      })
    } catch (err) {
      // Only a genuine network-level failure (offline, DNS, refused) lands here —
      // every HTTP response, including error responses, is classified by classifyFailure instead.
      throw new ChatRequestError('connection', 'Chat request failed before a response arrived', { cause: err })
    }
    if (!res.ok) throw await classifyFailure(res)
    let data: { reply?: unknown }
    try {
      data = (await res.json()) as { reply?: unknown }
    } catch (err) {
      throw new ChatRequestError('service', 'Chat API returned a 200 response that was not valid JSON', { cause: err })
    }
    if (typeof data.reply !== 'string' || data.reply.length === 0) {
      throw new ChatRequestError('service', 'Chat API returned no reply')
    }
    return data.reply
  }

  // Demo mode: a short human-feeling pause, then a scripted reply.
  await new Promise((resolve) => setTimeout(resolve, 650 + Math.random() * 550))
  const lastUser = [...thread].reverse().find((m) => m.role === 'user')?.content ?? ''
  return demoReply(lastUser)
}

/**
 * Streamed variant of getAssistantReply: emits reply text incrementally through
 * `onDelta` as it arrives, honoring `signal` for the stop button. Resolves
 * 'completed' when the reply finished normally and 'aborted' when the caller
 * cut it — every other failure throws the usual ChatRequestError kinds.
 */
export async function streamAssistantReply(
  thread: ThreadMessage[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<StreamOutcome> {
  if (!IS_DEMO) {
    // Never start a doomed request: an already-stopped generation stays stopped.
    if (signal.aborted) return 'aborted'
    let res: Response
    try {
      res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: thread, stream: true }),
        signal,
      })
    } catch (err) {
      if (signal.aborted) return 'aborted'
      // Only a genuine network-level failure (offline, DNS, refused) lands here —
      // every HTTP response, including error responses, is classified by classifyFailure instead.
      throw new ChatRequestError('connection', 'Chat request failed before a response arrived', { cause: err })
    }
    if (!res.ok) throw await classifyFailure(res)

    const contentType = res.headers.get('Content-Type') ?? ''
    // A backend predating the stream flag answers one-shot JSON — one delta.
    if (contentType.includes('application/json')) {
      let data: { reply?: unknown }
      try {
        data = (await res.json()) as { reply?: unknown }
      } catch (err) {
        throw new ChatRequestError('service', 'Chat API returned a 200 response that was not valid JSON', { cause: err })
      }
      if (typeof data.reply !== 'string' || data.reply.length === 0) {
        throw new ChatRequestError('service', 'Chat API returned no reply')
      }
      if (!signal.aborted) onDelta(data.reply)
      return 'completed'
    }
    if (res.body === null || !contentType.includes('text/event-stream')) {
      throw new ChatRequestError('service', 'Chat API did not answer with an SSE stream')
    }

    try {
      for await (const event of sseEvents(res.body)) {
        if (signal.aborted) return 'aborted'
        if (event.event === 'delta') {
          let text: unknown
          try {
            text = (JSON.parse(event.data) as { text?: unknown }).text
          } catch (err) {
            throw new ChatRequestError('service', 'Chat stream sent a malformed delta event', { cause: err })
          }
          if (typeof text === 'string' && text.length > 0) onDelta(text)
        } else if (event.event === 'done') {
          return 'completed'
        } else if (event.event === 'error') {
          // Mid-stream failure: the worker already reports its code inside the event.
          let code = 'unknown'
          try {
            code = String((JSON.parse(event.data) as { error?: { code?: unknown } }).error?.code ?? 'unknown')
          } catch {
            // An unreadable error payload still means the stream failed.
          }
          throw new ChatRequestError('service', `Chat stream reported an error (code ${code})`)
        }
      }
    } catch (err) {
      if (signal.aborted) return 'aborted'
      throw err instanceof ChatRequestError ? err : new ChatRequestError('service', 'Failed while reading the chat stream', { cause: err })
    }
    // The stream closed without done or error — the reply may be truncated, so
    // this is a service failure, not a silent success.
    throw new ChatRequestError('service', 'Chat stream closed before the reply finished')
  }

  // Demo mode: a short human-feeling pause, then the scripted reply in one piece.
  await new Promise((resolve) => setTimeout(resolve, 650 + Math.random() * 550))
  if (signal.aborted) return 'aborted'
  const lastUser = [...thread].reverse().find((m) => m.role === 'user')?.content ?? ''
  onDelta(demoReply(lastUser))
  return 'completed'
}

const ARABIC = /[\u0600-\u06FF]/
const CODE = /(code|bug|function|error|debug|typescript|javascript|python|react|كود|برمج|خطأ|سكربت)/
const LEARN = /(explain|learn|study|teach|understand|quiz|اشرح|تعلّم|تعلم|أفهم|لخص|تلخيص|درس)/
const WRITE = /(write|draft|essay|email|translate|proofread|اكتب|كتابة|ترجم|ترجمة|صياغة|مقال|رسالة)/

function demoReply(userText: string): string {
  const isAr = ARABIC.test(userText)
  const t = userText.toLowerCase()

  if (CODE.test(t)) return isAr ? demoCodingAr : demoCodingEn
  if (LEARN.test(t)) return isAr ? demoLearningAr : demoLearningEn
  if (WRITE.test(t)) return isAr ? demoWritingAr : demoWritingEn
  return isAr ? demoDefaultAr : demoDefaultEn
}

const demoDefaultEn = `I'm the demo stand-in for ZUNO's assistant — replies here are **scripted**, not generated by a live model. The interface around me is real: history, RTL, themes, and code highlighting all work.

Connect a backend by setting \`VITE_API_URL\` (see \`.env.example\`) and this same conversation will carry live model answers.

\`\`\`ts
// The message pipeline a live model would use
const res = await fetch(import.meta.env.VITE_API_URL + '/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: thread }),
})
const { reply } = await res.json()
\`\`\``

const demoDefaultAr = `أنا النسخة التجريبية من مساعد زونو — الردود هنا **مُعدّة مسبقًا** وليست مُولّدة من نموذج حي. أما الواجهة من حولي حقيقية: السجل واللغة والثيم وتلوين الأكواد كلها تعمل.

لربط نموذج حقيقي، اضبط \`VITE_API_URL\` (راجع \`.env.example\`) وستحمل هذه المحادثة نفسها ردودًا حية.`

const demoCodingEn = `Here's a scripted **coding** answer to show how code renders in ZUNO:

\`\`\`ts
export function debounce<T extends (...args: unknown[]) => void>(fn: T, wait = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}
\`\`\`

In a live session, the real model would read your actual snippet and answer in context. Set \`VITE_API_URL\` to enable that.`

const demoCodingAr = `هذه إجابة **برمجية** تجريبية لتوضيح طريقة عرض الأكواد في زونو:

\`\`\`ts
export function debounce<T extends (...args: unknown[]) => void>(fn: T, wait = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}
\`\`\`

في الجلسة الحية، سيقرأ النموذج الحقيقي كودك الفعلي ويجيب في سياقه. اضبط \`VITE_API_URL\` لتفعيل ذلك.`

const demoLearningEn = `Scripted **learning** answer: one technique that works for almost any topic is explain-it-back — study the idea, close the tab, explain it out loud in your own words, then reopen and check what you missed.

A live model would turn your topic into a full study plan with spaced-repetition steps. Set \`VITE_API_URL\` to enable that.`

const demoLearningAr = `إجابة **تعلّمية** تجريبية: أسلوب يشتغل مع أي موضوع تقريبًا هو "اشرحها بنفسك" — اقرأ الفكرة، أغلق الصفحة، اشرحها بصوت عالٍ بكلماتك، ثم أعد الفتح وتحقّق مما فاتك.

النموذج الحي سيحوّل موضوعك إلى خطة دراسة كاملة. اضبط \`VITE_API_URL\` لتفعيل ذلك.`

const demoWritingEn = `Scripted **writing** answer — a quick before/after:

> Before: "We are in receipt of your request and will act accordingly."
> After: "Got it — we're on it."

The lesson: cut the ceremony, keep the meaning. A live model would draft, refine or translate your actual text. Set \`VITE_API_URL\` to enable that.`

const demoWritingAr = `إجابة **كتابية** تجريبية — قبل وبعد بسرعة:

> قبل: "نحيطكم علماً بأنه تم استلام طلبكم وسيتم اتخاذ اللازم."
> بعد: "وصل الطلب، وأحنا شغالين عليه."

الخلاصة: قلّل الرسميات واحفظ المعنى. النموذج الحي سيصيغ أو يترجم نصك الحقيقي. اضبط \`VITE_API_URL\` لتفعيل ذلك.`
