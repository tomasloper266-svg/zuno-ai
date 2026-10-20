// @vitest-environment jsdom
/**
 * Component regression suite for the Regenerate one-request invariant
 * (spec art_9nIltQLr §4.3, tests T1–T6) plus the streaming + stop behavior.
 *
 * Seam: the REAL `Chat` component rendered through a small harness that mirrors
 * App.tsx's exact wiring (conversations + activeId state, setConversations,
 * onSelect). Only the engine boundary is mocked — `streamAssistantReply` via
 * vi.mock/importActual, so `ChatRequestError`, `recentMessagesForRequest` and
 * `IS_DEMO` stay real. Every test drives the real click handlers
 * (Regenerate, banner Retry, Composer Send, Stop) — no handler is re-implemented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Chat } from './Chat'
import { ChatRequestError, streamAssistantReply } from '../lib/engine'
import type { ThreadMessage } from '../lib/engine'
import { strings } from '../i18n/strings'
import type { Conversation, Message } from '../types'

vi.mock('../lib/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/engine')>()
  return { ...actual, streamAssistantReply: vi.fn() }
})

const t = strings.en
const replyMock = vi.mocked(streamAssistantReply)

/** Default streamed reply: one delta carrying `text`, then a clean completion. */
function streamReplyWith(text: string): void {
  replyMock.mockImplementation(async (_thread: ThreadMessage[], onDelta: (t: string) => void) => {
    onDelta(text)
    return 'completed'
  })
}

/** A streamed reply that stays pending (never emitting) until the test calls
 * `release` — which then emits one delta with `text` and completes the stream. */
function replyStreamPending(
  mock: ReturnType<typeof vi.mocked<typeof streamAssistantReply>>,
  onPending: (release: () => void) => void,
  text: string,
): void {
  mock.mockImplementation(
    (_thread: ThreadMessage[], onDelta: (t: string) => void) =>
      new Promise<'completed' | 'aborted'>((resolve) => {
        onPending(() => {
          onDelta(text)
          resolve('completed')
        })
      }),
  )
}

// Chat's auto-follow effect calls el.scrollTo(...) — jsdom does not implement
// element scrolling, so provide a no-op when it is missing.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = function scrollTo(): void {}
}

function msg(role: Message['role'], id: string, content: string): Message {
  return { id, role, content, ts: 1_700_000_000_000 }
}

function seededConversations(messages: Message[]): Conversation[] {
  return [{ id: 'conv-1', title: 'seeded conversation', createdAt: 1, messages }]
}

/** Harness holding the conversation state exactly like App.tsx does. */
function ChatHarness(props: { seed: Conversation[]; activeId: string | null }): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>(props.seed)
  const [activeId, setActiveId] = useState<string | null>(props.activeId)
  const conversation = conversations.find((c) => c.id === activeId) ?? null
  return (
    <>
      <Chat
        t={t}
        lang="en"
        theme="dark"
        onToggleLang={() => {}}
        onToggleTheme={() => {}}
        conversation={conversation}
        conversations={conversations}
        setConversations={setConversations}
        onSelect={setActiveId}
        onNew={() => setActiveId(null)}
        onHome={() => {}}
        seedPrompt=""
        onSeedConsumed={() => {}}
      />
      <div data-testid="conversations-state">{JSON.stringify(conversations)}</div>
    </>
  )
}

function renderChat(seed: Conversation[], activeId: string | null = seed[0]?.id ?? null): () => Conversation[] {
  render(<ChatHarness seed={seed} activeId={activeId} />)
  return () => JSON.parse(screen.getByTestId('conversations-state').textContent ?? '[]') as Conversation[]
}

function storedMessages(readState: () => Conversation[]): Message[] {
  return readState()[0]?.messages ?? []
}

function contents(messages: Message[]): string[] {
  return messages.map((m) => m.content)
}

function regenerateButton(): HTMLElement {
  return screen.getByRole('button', { name: t.chat.regenerate })
}

function retryButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: t.chat.retry }) as HTMLButtonElement
}

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('Chat one-request invariant (spec T1–T6)', () => {
  it('T1: one Regenerate click starts exactly one request and replaces the reply', async () => {
    streamReplyWith('regenerated reply')
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'first reply')]))

    fireEvent.click(regenerateButton())
    await screen.findByText('regenerated reply')

    expect(replyMock).toHaveBeenCalledTimes(1)
    expect(contents(storedMessages(readState))).toEqual(['hello', 'regenerated reply'])
  })

  it('T2: two rapid clicks in the same tick, before any re-render, start exactly one request', async () => {
    streamReplyWith('regenerated once')
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'first reply')]))
    const btn = regenerateButton()

    // Re-dispatch a second click from INSIDE the first click's dispatch: both
    // delegated handlers then run within one React batch off the same stale
    // render (pending=false, old messages) — the closure-staleness window the
    // synchronous guard exists for. Without the guard this fires two requests.
    let reDispatched = false
    const storm = (): void => {
      if (reDispatched) return
      reDispatched = true
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }
    btn.addEventListener('click', storm)
    try {
      fireEvent.click(btn)
    } finally {
      btn.removeEventListener('click', storm)
    }

    await screen.findByText('regenerated once')

    expect(replyMock).toHaveBeenCalledTimes(1)
    // exactly one pop happened: history is [user, new reply] — no duplicate reply
    expect(contents(storedMessages(readState))).toEqual(['hello', 'regenerated once'])
  })

  it('T3: regenerate replaces only the last reply, keeps full history, and sends the remaining thread', async () => {
    streamReplyWith('fresh reply')
    const readState = renderChat(
      seededConversations([
        msg('user', 'm1', 'q1'),
        msg('assistant', 'm2', 'r1'),
        msg('user', 'm3', 'q2'),
        msg('assistant', 'm4', 'r2'),
      ]),
    )

    fireEvent.click(regenerateButton())
    await screen.findByText('fresh reply')

    expect(replyMock).toHaveBeenCalledTimes(1)
    // the wire carries the full remaining thread: q1, r1, q2 — r2 was popped
    expect(replyMock.mock.calls[0]?.[0]).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'r1' },
      { role: 'user', content: 'q2' },
    ])
    const messages = storedMessages(readState)
    expect(contents(messages)).toEqual(['q1', 'r1', 'q2', 'fresh reply'])
    // user messages are never duplicated
    expect(messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['q1', 'q2'])
  })

  it('T4: a failed (429) regenerate shows the banner with one request; Retry re-sends exactly once and restores the reply', async () => {
    replyMock.mockRejectedValueOnce(new ChatRequestError('daily_limit', 'quota exhausted'))
    streamReplyWith('recovered reply')
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'first reply')]))

    fireEvent.click(regenerateButton())
    await screen.findByRole('alert')

    expect(replyMock).toHaveBeenCalledTimes(1)
    // designed remove-and-resend failure state: popped reply is gone, user message stays
    expect(contents(storedMessages(readState))).toEqual(['hello'])

    fireEvent.click(screen.getByRole('button', { name: t.chat.retry }))
    await screen.findByText('recovered reply')

    expect(screen.queryByRole('alert')).toBeNull()
    expect(replyMock).toHaveBeenCalledTimes(2) // failed regenerate + exactly one retry
    expect(contents(storedMessages(readState))).toEqual(['hello', 'recovered reply'])
  })

  it('T5: Send appends one user message and one reply with a single request', async () => {
    const user = userEvent.setup()
    streamReplyWith('demo answer')
    const readState = renderChat([], null) // fresh app: no conversations yet

    await user.type(screen.getByRole('textbox', { name: t.chat.placeholder }), 'hi there')
    await user.click(screen.getByRole('button', { name: t.send }))
    await screen.findByText('demo answer')

    expect(replyMock).toHaveBeenCalledTimes(1)
    expect(replyMock.mock.calls[0]?.[0]).toEqual([{ role: 'user', content: 'hi there' }])

    const conversations = readState()
    expect(conversations).toHaveLength(1)
    const messages = conversations[0]?.messages ?? []
    const userMessages = messages.filter((m) => m.role === 'user')
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0]?.content).toBe('hi there')
    expect(contents(messages)).toEqual([t.chat.greeting, 'hi there', 'demo answer'])
    expect(messages[0]?.seeded).toBe(true) // app-authored greeting seeded first
  })

  it('T6: banner Retry is guarded while pending — enabled once settled, banner clears during the retry, same-tick repeats start one request', async () => {
    replyMock.mockRejectedValueOnce(new ChatRequestError('daily_limit', 'quota exhausted'))
    let releaseRetry!: () => void
    replyStreamPending(replyMock, (release) => {
      releaseRetry = release
    }, 'recovered reply')
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'first reply')]))

    fireEvent.click(regenerateButton())
    await screen.findByRole('alert')

    // Post-failure the request has settled (pending=false): disabled={pending}
    // renders the banner Retry enabled — the only settled state in which the
    // banner exists, because runAssistant clears the error as it sets pending.
    const retryBtn = retryButton()
    expect(retryBtn.disabled).toBe(false)

    // Same-tick double activation of Retry: the re-render that would apply
    // disabled={pending} has not happened yet — the synchronous guard is the
    // protection in this window, so the second activation must be a no-op.
    let reDispatched = false
    const storm = (): void => {
      if (reDispatched) return
      reDispatched = true
      retryBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }
    retryBtn.addEventListener('click', storm)
    try {
      fireEvent.click(retryBtn)
    } finally {
      retryBtn.removeEventListener('click', storm)
    }

    // While the retry request is in flight: error banner is cleared (the app's
    // pending protection — the Retry control is not even present), and exactly
    // one extra request was started despite the storm.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(replyMock).toHaveBeenCalledTimes(2)

    releaseRetry()
    await screen.findByText('recovered reply')

    expect(screen.queryByRole('alert')).toBeNull()
    expect(contents(storedMessages(readState))).toEqual(['hello', 'recovered reply'])
  })
})

describe('Chat streaming + stop behavior', () => {
  /** Custom text matcher: the live streaming bubble (never a typing indicator,
   * never a committed MessageBubble which carries extra classes). */
  function streamingBubble(text: string): (content: string, element: Element | null) => boolean {
    return (_content, element) => element?.className === 'bubble assistant' && element.textContent === text
  }

  it('S1: renders deltas into the growing bubble as they arrive, then commits the full reply exactly once', async () => {
    let emitSecond!: () => void
    const second = new Promise<void>((resolve) => {
      emitSecond = resolve
    })
    replyMock.mockImplementation(async (_thread: ThreadMessage[], onDelta: (t: string) => void) => {
      onDelta('part one,')
      await second
      onDelta(' part two')
      return 'completed'
    })
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'old reply')]))

    fireEvent.click(regenerateButton())

    // First delta is visible while still pending; stop button is the composer action.
    await screen.findByText(streamingBubble('part one,'))
    expect(screen.queryByText('part one, part two')).toBeNull()
    expect(screen.getByRole('button', { name: t.chat.stopGenerating })).toBeTruthy()

    emitSecond()
    await screen.findByText('part one, part two')

    // Committed exactly once as the new last message; streaming UI fully settled.
    expect(contents(storedMessages(readState))).toEqual(['hello', 'part one, part two'])
    // A completed reply is never flagged stopped.
    expect(storedMessages(readState)[1]?.stopped).toBeUndefined()
    expect(screen.queryByRole('button', { name: t.chat.stopGenerating })).toBeNull()
    expect(screen.queryByText(streamingBubble('part one,'))).toBeNull()
  })

  it('S2: Stop aborts the in-flight stream and commits the partial text already received — no error banner', async () => {
    const signals: AbortSignal[] = []
    replyMock.mockImplementation(
      (_thread: ThreadMessage[], onDelta: (t: string) => void, signal: AbortSignal) => {
        signals.push(signal)
        onDelta('partial text,')
        return new Promise<'completed' | 'aborted'>((resolve) => {
          if (signal.aborted) {
            resolve('aborted')
            return
          }
          signal.addEventListener('abort', () => resolve('aborted'), { once: true })
        })
      },
    )
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'old reply')]))

    fireEvent.click(regenerateButton())
    await screen.findByText(streamingBubble('partial text,'))
    expect(replyMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: t.chat.stopGenerating }))

    // The partial text the reader saw is exactly what gets committed — flagged stopped.
    await waitFor(() => expect(contents(storedMessages(readState))).toEqual(['hello', 'partial text,']))
    expect(storedMessages(readState)[1]?.stopped).toBe(true)
    expect(signals[0]?.aborted).toBe(true)
    // Stopping is not a failure: no banner, no retry offered, composer back to send.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: t.chat.stopGenerating })).toBeNull()
  })

  it('S3: stopping before the first delta commits nothing and shows no banner', async () => {
    replyMock.mockImplementation(
      (_thread: ThreadMessage[], _onDelta: (t: string) => void, signal: AbortSignal) =>
        new Promise<'completed' | 'aborted'>((resolve) => {
          if (signal.aborted) {
            resolve('aborted')
            return
          }
          signal.addEventListener('abort', () => resolve('aborted'), { once: true })
        }),
    )
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'old reply')]))

    fireEvent.click(regenerateButton())
    await screen.findByRole('button', { name: t.chat.stopGenerating })
    fireEvent.click(screen.getByRole('button', { name: t.chat.stopGenerating }))

    // Popped reply stays gone, no partial text existed, so nothing is committed.
    await waitFor(() => expect(screen.queryByRole('button', { name: t.chat.stopGenerating })).toBeNull())
    expect(contents(storedMessages(readState))).toEqual(['hello'])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('S4: a mid-stream failure surfaces the error banner; already-shown partial text is not committed', async () => {
    replyMock.mockRejectedValueOnce(new ChatRequestError('service', 'stream failed midway'))
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'old reply')]))

    fireEvent.click(regenerateButton())
    await screen.findByRole('alert')

    expect(contents(storedMessages(readState))).toEqual(['hello'])
    expect(screen.queryByRole('button', { name: t.chat.stopGenerating })).toBeNull()
  })

  it('S4b: a mid-stream failure after partial text salvages the partial as a failed message with an in-place retry', async () => {
    replyMock.mockImplementationOnce(async (_thread: ThreadMessage[], onDelta: (t: string) => void) => {
      onDelta('salvaged partial,')
      throw new ChatRequestError('service', 'stream failed midway')
    })
    streamReplyWith('recovered in place')
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'old reply')]))

    fireEvent.click(regenerateButton())

    // The partial the reader saw is kept — committed as a FAILED message.
    await waitFor(() => expect(contents(storedMessages(readState))).toEqual(['hello', 'salvaged partial,']))
    const failed = storedMessages(readState)[1]
    expect(failed?.failed).toBe(true)
    // No global banner: the message itself carries the failure state and retry,
    // which replace Regenerate on a failed reply.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: t.chat.retry })).not.toBeNull()
    expect(screen.queryByRole('button', { name: t.chat.regenerate })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: t.chat.retry }))

    // Replaced IN PLACE: same stable message id, no duplicate, failure cleared,
    // and the retry's thread carries only the prefix (never the partial itself).
    await screen.findByText('recovered in place')
    const messages = storedMessages(readState)
    expect(contents(messages)).toEqual(['hello', 'recovered in place'])
    expect(messages[1]?.id).toBe(failed?.id)
    expect(messages[1]?.failed).toBeUndefined()
    expect(replyMock).toHaveBeenCalledTimes(2)
    expect(replyMock.mock.calls[1]?.[0]).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('S5: the stall watchdog auto-cancel commits the partial the reader saw, with no banner and a settled composer', async () => {
    replyMock.mockImplementation(async (_thread: ThreadMessage[], onDelta: (t: string) => void) => {
      onDelta('watchdog partial')
      return 'watchdog'
    })
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'old reply')]))

    fireEvent.click(regenerateButton())

    await screen.findByText('watchdog partial')
    await waitFor(() => expect(contents(storedMessages(readState))).toEqual(['hello', 'watchdog partial']))
    expect(storedMessages(readState)[1]?.stopped).toBe(true)
    // Auto-cancel is not a crash and not the user's stop: what the reader saw is
    // kept, no banner, and the streaming UI is fully released.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: t.chat.stopGenerating })).toBeNull()
  })

  it('S6: watchdog auto-cancel before any delta shows the service recovery banner with a retry', async () => {
    replyMock.mockResolvedValueOnce('watchdog')
    renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'old reply')]))

    fireEvent.click(regenerateButton())

    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain(t.chat.errors.service.title)
    expect(screen.queryByRole('button', { name: t.chat.retry })).toBeTruthy()
  })
})

describe('Offline banner (truthful offline state)', () => {
  /** jsdom exposes onLine as a getter — swap it per test and always restore. */
  function setOnline(online: boolean): void {
    Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true })
  }

  afterEach(() => {
    // Remove the per-test override so the original jsdom getter shows through.
    delete (window.navigator as { onLine?: boolean }).onLine
  })

  it('shows the dedicated offline copy when a connection failure happens while the browser is offline', async () => {
    setOnline(false)
    replyMock.mockRejectedValueOnce(new ChatRequestError('connection', 'network down'))
    renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'first reply')]))

    fireEvent.click(regenerateButton())
    const banner = await screen.findByRole('alert')

    expect(banner.textContent).toContain(t.chat.offline.title)
    expect(banner.textContent).toContain(t.chat.offline.body)
    // The generic connection copy would undersell the state — absent here.
    expect(banner.textContent).not.toContain(t.chat.errors.connection.title)
  })

  it('shows the generic connection copy for the same failure while the browser reports online', async () => {
    setOnline(true)
    replyMock.mockRejectedValueOnce(new ChatRequestError('connection', 'network error'))
    renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'first reply')]))

    fireEvent.click(regenerateButton())
    const banner = await screen.findByRole('alert')

    expect(banner.textContent).toContain(t.chat.errors.connection.title)
    expect(banner.textContent).not.toContain(t.chat.offline.title)
  })

  it('never claims offline for engine-classified failures (quota, service)', async () => {
    setOnline(false) // offline at failure time — yet the failure is not a network failure
    replyMock.mockRejectedValueOnce(new ChatRequestError('daily_limit', 'quota exhausted'))
    renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'first reply')]))

    fireEvent.click(regenerateButton())
    const banner = await screen.findByRole('alert')

    expect(banner.textContent).toContain(t.chat.errors.daily_limit.title)
    expect(banner.textContent).not.toContain(t.chat.offline.title)
  })
})
