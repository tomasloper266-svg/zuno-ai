import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadMessage } from './engine'

// engine.ts captures API_BASE from import.meta.env at module load — stub the
// backend URL BEFORE importing it, so the live fetch path (not demo mode) runs.
vi.stubEnv('VITE_API_URL', 'https://api.example.test')

const { getAssistantReply, recentMessagesForRequest, ChatRequestError } = await import('./engine')

/** The instance type of the dynamically imported ChatRequestError class value. */
type ChatRequestErrorInstance = InstanceType<typeof ChatRequestError>

function message(role: ThreadMessage['role'], content: string): ThreadMessage {
  return { role, content }
}

/** A thread of `count` alternating turns with unique, order-provable contents. */
function threadOf(count: number): ThreadMessage[] {
  return Array.from({ length: count }, (_, i) => message(i % 2 === 0 ? 'user' : 'assistant', `m${i + 1}`))
}

/** Return the error a failing request threw — or fail the test if it resolved. */
async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (err) {
    return err
  }
  throw new Error('expected the chat request to fail, but it resolved')
}

function stubFetch(status: number, body: string, headers?: Record<string, string>): void {
  vi.stubGlobal('fetch', async () => new Response(body, { status, headers }))
}

function errorKindOf(run: () => Promise<unknown>): Promise<string> {
  return failureOf(run).then((err) => {
    expect(err).toBeInstanceOf(ChatRequestError)
    return (err as ChatRequestErrorInstance).kind
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recentMessagesForRequest', () => {
  it('keeps a thread of exactly 20 messages unchanged', () => {
    const thread = threadOf(20)
    const result = recentMessagesForRequest(thread)
    expect(result.trimmed).toBe(false)
    expect(result.messages).toEqual(thread)
  })

  it.each([21, 25, 41])('sends exactly the last 20 of %i messages, in order, newest included', (count) => {
    const thread = threadOf(count)
    const result = recentMessagesForRequest(thread)
    expect(result.trimmed).toBe(true)
    expect(result.messages).toHaveLength(20)
    expect(result.messages).toEqual(thread.slice(-20))
    expect(result.messages.at(-1)?.content).toBe(`m${count}`)
  })

  it('keeps a trailing user message last', () => {
    const thread = threadOf(25)
    const finalQuestion = message('user', 'final question')
    thread[thread.length - 1] = finalQuestion
    const result = recentMessagesForRequest(thread)
    expect(result.trimmed).toBe(true)
    expect(result.messages.at(-1)).toBe(finalQuestion)
  })
})

describe('getAssistantReply', () => {
  it('sends the thread it is given as { messages } and returns the reply', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ reply: 'ahlan' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const thread = threadOf(5)
    await expect(getAssistantReply(thread)).resolves.toBe('ahlan')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The engine's fixed call shape: fetch(url, init) with a JSON body.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.test/chat')
    expect(JSON.parse(String(init.body))).toEqual({ messages: thread })
  })

  it('classifies a 400 invalid_request body as an invalid request', async () => {
    stubFetch(400, JSON.stringify({ error: { code: 'invalid_request' } }), {
      'Content-Type': 'application/json',
    })
    await expect(errorKindOf(() => getAssistantReply(threadOf(3)))).resolves.toBe('invalid')
  })

  it('classifies a 400 with a non-JSON body as invalid via the status', async () => {
    stubFetch(400, '<html>Bad Request</html>')
    await expect(errorKindOf(() => getAssistantReply(threadOf(3)))).resolves.toBe('invalid')
  })

  it('keeps a short Retry-After 429 a burst limit (too_fast)', async () => {
    stubFetch(429, JSON.stringify({ error: { code: 'rate_limited' } }), { 'Retry-After': '30' })
    await expect(errorKindOf(() => getAssistantReply(threadOf(3)))).resolves.toBe('too_fast')
  })

  it('keeps a long-window 429 an exhausted quota (daily_limit)', async () => {
    stubFetch(429, JSON.stringify({ error: { code: 'rate_limited' } }), { 'Retry-After': '600' })
    await expect(errorKindOf(() => getAssistantReply(threadOf(3)))).resolves.toBe('daily_limit')
  })

  it('keeps a 500 a service fault', async () => {
    stubFetch(500, JSON.stringify({ error: { code: 'internal_error' } }))
    await expect(errorKindOf(() => getAssistantReply(threadOf(3)))).resolves.toBe('service')
  })
})
