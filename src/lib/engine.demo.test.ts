/**
 * Demo-mode engine tests: no VITE_API_URL stub is set, so the engine module
 * loads in demo mode and streamAssistantReply paces the scripted reply out in
 * chunks — same streaming UX as live mode, no network, honest demo behavior.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadMessage } from './engine'

const { streamAssistantReply, chunkDemoReply } = await import('./engine')

function message(role: ThreadMessage['role'], content: string): ThreadMessage {
  return { role, content }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('chunkDemoReply', () => {
  it('splits on word boundaries with whitespace attached, joining back to the original text', () => {
    const reply = 'أهلاً بك! كيف أقدر أساعدك اليوم؟'
    const chunks = chunkDemoReply(reply)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(reply)
    expect(chunks[0]).toBe('أهلاً ')
  })

  it('splits oversized words (URLs, code tokens) into bounded runs', () => {
    const url = 'https://example.com/very/long/path'
    const chunks = chunkDemoReply(url)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(url)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(14)
  })

  it('handles a single short word as one chunk', () => {
    expect(chunkDemoReply('أهلاً')).toEqual(['أهلاً'])
  })
})

describe('streamAssistantReply (demo)', () => {
  it('emits the scripted reply in several chunks with a pacing pause, then completes', async () => {
    vi.useFakeTimers()
    const thread = [message('user', 'hello')]
    const seen: string[] = []

    const pending = streamAssistantReply(thread, (t) => seen.push(t), new AbortController().signal)
    await vi.runAllTimersAsync()
    const outcome = await pending

    expect(outcome).toBe('completed')
    expect(seen.length).toBeGreaterThan(1) // chunked, not one-shot
    expect(seen.join('').length).toBeGreaterThan(0)
    // No chunk exceeds the pacing bound.
    for (const chunk of seen) expect(chunk.length).toBeLessThanOrEqual(14)
  })

  it('honors an abort mid-stream: chunks after the stop never reach the caller', async () => {
    vi.useFakeTimers()
    const thread = [message('user', 'hello')]
    const seen: string[] = []
    const controller = new AbortController()

    const pending = streamAssistantReply(thread, (t) => {
      seen.push(t)
      // Stop the generation the moment the second chunk arrives.
      if (seen.length === 2) controller.abort()
    }, controller.signal)
    await vi.runAllTimersAsync()
    const outcome = await pending

    expect(outcome).toBe('aborted')
    expect(seen).toHaveLength(2)
  })

  it('resolves aborted immediately, without emitting, when stopped before the request', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()
    const seen: string[] = []

    const pending = streamAssistantReply([message('user', 'hello')], (t) => seen.push(t), controller.signal)
    await vi.runAllTimersAsync()
    const outcome = await pending

    expect(outcome).toBe('aborted')
    expect(seen).toEqual([])
  })

  it('never touches the network in demo mode', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const pending = streamAssistantReply([message('user', 'hello')], () => {}, new AbortController().signal)
    await vi.runAllTimersAsync()
    await pending

    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
