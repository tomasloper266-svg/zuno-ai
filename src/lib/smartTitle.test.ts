// @vitest-environment jsdom
/** Unit tests for the smart-title client module: the wire body, the title
 * sanitizer, and the silent-fallback contract of requestSmartTitle (success,
 * failure, deadline, malformed payload) against a stubbed fetch. The engine
 * module is mocked to a live configuration — demo mode has its own file. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestSmartTitle, buildTitleBody, sanitizeSmartTitle, SMART_TITLE_TIMEOUT_MS } from './smartTitle'

vi.mock('./engine', () => ({ API_BASE: 'https://worker.test', IS_DEMO: false }))

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  // The offline test overrides jsdom's navigator.onLine — restore it so the
  // override never leaks into later tests in this file.
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
})

function okTitle(title: unknown): Response {
  return new Response(JSON.stringify({ title }), { status: 200 })
}

describe('buildTitleBody', () => {
  it('builds the exact { user, assistant } wire body', () => {
    expect(buildTitleBody({ user: 'مرحبا', assistant: 'أهلاً' })).toBe(
      JSON.stringify({ user: 'مرحبا', assistant: 'أهلاً' }),
    )
  })

  it('truncates to the worker caps (2000 user, 1000 assistant) before sending', () => {
    const parsed = JSON.parse(
      buildTitleBody({ user: 'u'.repeat(3000), assistant: 'a'.repeat(1500) }),
    ) as { user: string; assistant: string }
    expect(parsed.user.length).toBe(2000)
    expect(parsed.assistant.length).toBe(1000)
  })
})

describe('sanitizeSmartTitle', () => {
  it('passes a clean title through', () => {
    expect(sanitizeSmartTitle('كيف أبدأ مع React')).toBe('كيف أبدأ مع React')
  })

  it('strips wrapping quotes and trailing sentence periods', () => {
    expect(sanitizeSmartTitle('"Hello there."')).toBe('Hello there')
    expect(sanitizeSmartTitle('«عنوان ذكي»')).toBe('عنوان ذكي')
    expect(sanitizeSmartTitle('Learning JS…')).toBe('Learning JS')
  })

  it('collapses whitespace and rejects non-strings and empties', () => {
    expect(sanitizeSmartTitle('  a\n\n b\tc  ')).toBe('a b c')
    expect(sanitizeSmartTitle(undefined)).toBe('')
    expect(sanitizeSmartTitle(42)).toBe('')
    expect(sanitizeSmartTitle('   ')).toBe('')
  })

  it('caps at 80 code points on a word boundary without splitting surrogates', () => {
    const long = `${'ab '.repeat(40)}تails`
    const capped = sanitizeSmartTitle(long)
    expect([...capped].length).toBeLessThanOrEqual(80)
    expect(capped.endsWith('ab')).toBe(true)
    // A surrogate pair is never split in half.
    expect(sanitizeSmartTitle('🚀'.repeat(100)).includes('\uFFFD')).toBe(false)
  })
})

describe('requestSmartTitle', () => {
  it('returns null when the browser is offline — no fetch', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    await expect(
      requestSmartTitle({ user: 'q', assistant: 'a' }, new AbortController().signal),
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs to /title with JSON headers, the truncated body, and returns the sanitized title', async () => {
    fetchMock.mockResolvedValue(okTitle('  "Smart title."  '))
    const title = await requestSmartTitle(
      { user: 'first question', assistant: 'first reply' },
      new AbortController().signal,
    )
    expect(title).toBe('Smart title')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://worker.test/title')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.body).toBe(buildTitleBody({ user: 'first question', assistant: 'first reply' }))
  })

  it('returns null on a non-OK response — never throws', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":{"code":"rate_limited"}}', { status: 429 }))
    await expect(
      requestSmartTitle({ user: 'q', assistant: 'a' }, new AbortController().signal),
    ).resolves.toBeNull()
  })

  it('returns null on a malformed or empty title payload', async () => {
    fetchMock.mockResolvedValue(okTitle('   '))
    await expect(
      requestSmartTitle({ user: 'q', assistant: 'a' }, new AbortController().signal),
    ).resolves.toBeNull()
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))
    await expect(
      requestSmartTitle({ user: 'q', assistant: 'a' }, new AbortController().signal),
    ).resolves.toBeNull()
  })

  it('returns null immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(requestSmartTitle({ user: 'q', assistant: 'a' }, controller.signal)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts itself at the 6s deadline and resolves null', async () => {
    vi.useFakeTimers()
    try {
      // A fetch that never settles on its own but rejects when aborted.
      fetchMock.mockImplementation(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          }),
      )
      const pending = requestSmartTitle({ user: 'q', assistant: 'a' }, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(SMART_TITLE_TIMEOUT_MS)
      await expect(pending).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('wires the caller signal through — an external abort rejects the fetch', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    const pending = requestSmartTitle({ user: 'q', assistant: 'a' }, controller.signal)
    controller.abort()
    await expect(pending).resolves.toBeNull()
  })
})
