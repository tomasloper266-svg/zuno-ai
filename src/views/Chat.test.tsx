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

vi.mock('../lib/conversationExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/conversationExport')>()
  return { ...actual, downloadTextFile: vi.fn() }
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

describe('Composer limit enforcement (input-box limits from the Worker contract)', () => {
  const near = 'a'.repeat(3600) // exactly 90% of the 4000-char message limit
  const over = 'a'.repeat(4001)

  function sendButton(): HTMLButtonElement {
    return screen.getByRole('button', { name: t.send }) as HTMLButtonElement
  }

  function draftBox(): HTMLTextAreaElement {
    return screen.getByRole('textbox', { name: t.chat.placeholder }) as HTMLTextAreaElement
  }

  it('L1: shows the limit counter near the limit and still sends', async () => {
    const user = userEvent.setup()
    streamReplyWith('ok')
    const readState = renderChat([], null)

    fireEvent.change(draftBox(), { target: { value: near } })
    const counter = screen.getByText(/in request/)
    expect(counter.classList.contains('composer-counter')).toBe(true)
    expect(counter.classList.contains('is-over')).toBe(false)
    expect(sendButton().hasAttribute('disabled')).toBe(false)

    await user.click(sendButton())
    // findByText alone can catch the transient streaming delta before the
    // commit — assert on the settled conversation instead: greeting, the
    // near-limit user message, and the reply.
    await waitFor(() => expect(contents(storedMessages(readState))).toEqual([t.chat.greeting, near, 'ok']))
  })

  it('L2: blocks sending over the message limit with a clear message, never blocks typing', () => {
    const readState = renderChat([], null)
    fireEvent.change(draftBox(), { target: { value: over } })

    // The over-limit counter is an alert carrying the plain-language reason.
    const counter = screen.getByRole('alert')
    expect(counter.classList.contains('is-over')).toBe(true)
    expect(counter.textContent).toContain(t.chat.limitExceeded)

    // Send is refused from both paths: the disabled button and the Enter key.
    expect(sendButton().hasAttribute('disabled')).toBe(true)
    fireEvent.keyDown(draftBox(), { key: 'Enter', shiftKey: false })
    expect(storedMessages(readState)).toEqual([])
    expect(replyMock).not.toHaveBeenCalled()

    // Typing is never prevented — the over-limit draft still accepts input.
    fireEvent.change(draftBox(), { target: { value: `${over}more` } })
    expect(draftBox().value.length).toBe(4005)
    expect(screen.getByRole('alert')).not.toBeNull()
  })

  it('L3: blocks sending when the request total exceeds its limit even with a short draft', () => {
    // 7,700 unseeded chars already in the thread + a 400-char draft > 8,000.
    renderChat(seededConversations([msg('user', 'm1', 'u'.repeat(7700))]))
    fireEvent.change(draftBox(), { target: { value: 'd'.repeat(400) } })

    const counter = screen.getByRole('alert')
    expect(counter.textContent).toContain(t.chat.limitExceeded)
    expect(sendButton().hasAttribute('disabled')).toBe(true)
    expect(replyMock).not.toHaveBeenCalled()
  })

  it('L4: a short draft in a short conversation never shows the counter or an alert', () => {
    renderChat([], null)
    fireEvent.change(draftBox(), { target: { value: 'hello' } })
    expect(screen.queryByText(/in request/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(sendButton().hasAttribute('disabled')).toBe(false)
  })
})

describe('Pending reset on every end path — a conversation never stays stuck', () => {
  /** Two conversations so every path test can also switch and delete. Titles
   * are pinned (titleProvisional: false) — the first commit must not rewrite
   * them into heuristic names and break the accessible-name lookups. */
  function twoConversations(): Conversation[] {
    return [
      { id: 'conv-1', title: 'first', createdAt: 1, titleProvisional: false, messages: [msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'first reply')] },
      { id: 'conv-2', title: 'second', createdAt: 2, titleProvisional: false, messages: [msg('user', 'n1', 'other conversation')] },
    ]
  }

  function draftBox(): HTMLTextAreaElement {
    return screen.getByRole('textbox', { name: t.chat.placeholder }) as HTMLTextAreaElement
  }

  function sendButton(): HTMLButtonElement {
    return screen.getByRole('button', { name: t.send }) as HTMLButtonElement
  }

  /** The generating state must be gone the moment a path ends: no stop button,
   * and a fresh draft immediately enables sending again. */
  async function expectSettled(): Promise<void> {
    await waitFor(() => expect(screen.queryByRole('button', { name: t.chat.stopGenerating })).toBeNull())
    fireEvent.change(draftBox(), { target: { value: 'next message' } })
    expect(sendButton().hasAttribute('disabled')).toBe(false)
  }

  function switchToSecond(): void {
    fireEvent.click(screen.getByRole('button', { name: 'second' }))
    expect(screen.getByText('other conversation')).not.toBeNull()
  }

  it('P1: clean completion releases the conversation — send, switch, and delete all work', async () => {
    streamReplyWith('done reply')
    const readState = renderChat(twoConversations())

    fireEvent.click(regenerateButton())
    await expectSettled()

    switchToSecond()
    fireEvent.click(screen.getByRole('button', { name: 'first' }))
    expect(screen.getByText('done reply')).not.toBeNull()

    // Deleting the OTHER conversation works right after settle — through the
    // confirmation dialog (a destructive tap is never one click).
    const deletes = screen.getAllByRole('button', { name: t.chat.delete })
    fireEvent.click(deletes[1] ?? document.body)
    fireEvent.click(screen.getByRole('button', { name: t.chat.deleteConfirmAction }))
    expect(screen.queryByRole('button', { name: 'second' })).toBeNull()
    expect(contents(readState().find((c) => c.id === 'conv-1')?.messages ?? [])).toEqual(['hello', 'done reply'])
  })

  it('P2: a zero-text stream failure shows the recovery banner and releases the conversation at once', async () => {
    replyMock.mockRejectedValueOnce(new ChatRequestError('service', 'empty failure'))
    const readState = renderChat(twoConversations())

    fireEvent.click(regenerateButton())
    await screen.findByRole('alert')
    await expectSettled()

    // The banner retry is immediately usable — the conversation is not stuck.
    // Designed remove-and-resend semantics: the popped reply stays gone, and
    // the retry commits a fresh reply after the user message.
    streamReplyWith('recovered after empty failure')
    fireEvent.click(screen.getByRole('button', { name: t.chat.retry }))
    await waitFor(() =>
      expect(contents(readState().find((c) => c.id === 'conv-1')?.messages ?? [])).toEqual([
        'hello',
        'recovered after empty failure',
      ]),
    )

    // Switching still works after the whole recovery (it clears the banner —
    // designed — but the conversation is free).
    switchToSecond()
  })

  it('P3: the user stop (before any delta) releases the conversation immediately', async () => {
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
    const readState = renderChat(twoConversations())

    fireEvent.click(regenerateButton())
    fireEvent.click(screen.getByRole('button', { name: t.chat.stopGenerating }))
    await expectSettled()
    switchToSecond()

    // Designed remove-and-resend semantics: stopping before any text commits
    // nothing and the popped reply stays gone — no partial, no loss of the
    // user message, no banner.
    fireEvent.click(screen.getByRole('button', { name: 'first' }))
    expect(contents(readState().find((c) => c.id === 'conv-1')?.messages ?? [])).toEqual(['hello'])
  })

  it('P4: a watchdog outcome after a partial commits the partial and releases the conversation', async () => {
    replyMock.mockImplementation(async (_thread: ThreadMessage[], onDelta: (t: string) => void) => {
      onDelta('stalled partial,')
      return 'watchdog'
    })
    const readState = renderChat(twoConversations())

    fireEvent.click(regenerateButton())
    await waitFor(() => expect(contents(readState().find((c) => c.id === 'conv-1')?.messages ?? [])).toEqual(['hello', 'stalled partial,']))
    await expectSettled()
    switchToSecond()
  })

  it('P5: a watchdog outcome with zero text shows the recovery banner and releases the conversation', async () => {
    replyMock.mockResolvedValueOnce('watchdog')
    const readState = renderChat(twoConversations())

    fireEvent.click(regenerateButton())
    await screen.findByRole('alert')
    await expectSettled()
    switchToSecond()

    // Designed remove-and-resend semantics: the popped reply stays gone.
    fireEvent.click(screen.getByRole('button', { name: 'first' }))
    expect(contents(readState().find((c) => c.id === 'conv-1')?.messages ?? [])).toEqual(['hello'])
  })

  it('P6: a mid-stream failure with salvaged partials releases the conversation for sending and switching', async () => {
    replyMock.mockImplementationOnce(async (_thread: ThreadMessage[], onDelta: (t: string) => void) => {
      onDelta('failed midway partial,')
      throw new ChatRequestError('service', 'stream failed midway')
    })
    const readState = renderChat(twoConversations())

    fireEvent.click(regenerateButton())
    await waitFor(() => expect(contents(readState().find((c) => c.id === 'conv-1')?.messages ?? [])).toEqual(['hello', 'failed midway partial,']))
    await expectSettled()
    switchToSecond()

    fireEvent.click(screen.getByRole('button', { name: 'first' }))
    expect(screen.getByRole('button', { name: t.chat.retry })).not.toBeNull()
  })

  it('P7: switching conversations mid-stream shows nothing of the stream in the other view; the reply commits to its own conversation', async () => {
    let release!: () => void
    replyStreamPending(replyMock, (r) => {
      release = r
    }, 'secret stream text')
    const readState = renderChat(twoConversations())

    // The stream starts in conv-1 and stays pending while the reader leaves.
    fireEvent.click(regenerateButton())
    switchToSecond()

    // The other conversation's view is clean: no streamed text and no
    // per-conversation streaming bubble. (The composer's stop button is the
    // global generating state — it truthfully says a stream is running and
    // blocks a second concurrent send; it is not a leak into this view.)
    expect(screen.queryByText('secret stream text')).toBeNull()
    expect(
      Array.from(document.querySelectorAll('.bubble.assistant')).some((el) => el.textContent === 'secret stream text'),
    ).toBe(false)
    expect(contents(readState().find((c) => c.id === 'conv-2')?.messages ?? [])).toEqual(['other conversation'])

    // Completing commits to the streaming conversation only — the viewed one
    // keeps exactly its own messages.
    release()
    await waitFor(() =>
      expect(contents(readState().find((c) => c.id === 'conv-1')?.messages ?? [])).toEqual(['hello', 'secret stream text']),
    )
    expect(screen.queryByText('secret stream text')).toBeNull()
    expect(contents(readState().find((c) => c.id === 'conv-2')?.messages ?? [])).toEqual(['other conversation'])

    // Returning shows the committed reply with the streaming UI fully settled.
    fireEvent.click(screen.getByRole('button', { name: 'first' }))
    expect(screen.getByText('secret stream text')).not.toBeNull()
    expect(screen.queryByRole('button', { name: t.chat.stopGenerating })).toBeNull()
  })
})

describe('Conversation deletion — confirmed, never silent (wave DE)', () => {
  function twoConversations(): Conversation[] {
    return [
      { id: 'conv-1', title: 'first', createdAt: 1, titleProvisional: false, messages: [msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'first reply')] },
      { id: 'conv-2', title: 'second', createdAt: 2, titleProvisional: false, messages: [msg('user', 'n1', 'other conversation')] },
    ]
  }

  function deleteButtons(): HTMLElement[] {
    return screen.getAllByRole('button', { name: t.chat.delete })
  }

  function confirmDeleteButton(): HTMLElement {
    return screen.getByRole('button', { name: t.chat.deleteConfirmAction })
  }

  it('D1: the delete button alone never deletes — it opens the confirmation dialog', () => {
    const readState = renderChat(twoConversations())

    fireEvent.click(deleteButtons()[0] as HTMLElement)

    expect(screen.getByRole('dialog', { name: t.chat.deleteConfirmTitle })).not.toBeNull()
    // Nothing is gone: the destructive action waits for confirmation.
    expect(readState()).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'first' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'second' })).not.toBeNull()
  })

  it('D2: confirming the dialog deletes the conversation permanently', () => {
    const readState = renderChat(twoConversations())

    fireEvent.click(deleteButtons()[1] as HTMLElement)
    fireEvent.click(confirmDeleteButton())

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readState().map((c) => c.id)).toEqual(['conv-1'])
    expect(screen.queryByRole('button', { name: 'second' })).toBeNull()
  })

  it('D3: cancel (button or Escape) keeps both conversations and closes the dialog', () => {
    const readState = renderChat(twoConversations())

    fireEvent.click(deleteButtons()[0] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: t.chat.cancel }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readState()).toHaveLength(2)

    // The Escape path cancels too.
    fireEvent.click(deleteButtons()[0] as HTMLElement)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readState()).toHaveLength(2)
  })

  it('D4: deleting the streaming conversation aborts its stream cleanly — the guarded commit no-ops and nothing sticks', async () => {
    const signals: AbortSignal[] = []
    let release!: () => void
    replyMock.mockImplementation(
      (_thread: ThreadMessage[], onDelta: (t: string) => void, signal: AbortSignal) => {
        signals.push(signal)
        onDelta('streaming text,')
        return new Promise<'completed' | 'aborted'>((resolve) => {
          release = () => {
            onDelta(' more')
            resolve(signal.aborted ? 'aborted' : 'completed')
          }
          if (signal.aborted) resolve('aborted')
          else signal.addEventListener('abort', () => resolve('aborted'), { once: true })
        })
      },
    )
    const readState = renderChat(twoConversations())

    fireEvent.click(regenerateButton())
    await waitFor(() => expect(signals).toHaveLength(1))

    fireEvent.click(deleteButtons()[0] as HTMLElement)
    fireEvent.click(confirmDeleteButton())

    // The stream got a clean cancel — no exception, no stuck generating state.
    expect(signals[0]?.aborted).toBe(true)
    await waitFor(() => expect(screen.queryByRole('button', { name: t.chat.stopGenerating })).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()

    // The guarded commit no-ops: the deleted conversation is never resurrected.
    expect(readState().map((c) => c.id)).toEqual(['conv-2'])
    release()
    expect(readState().map((c) => c.id)).toEqual(['conv-2'])

    // The composer is fully usable again.
    const composer = screen.getByRole('textbox', { name: t.chat.placeholder }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'next message' } })
    expect((screen.getByRole('button', { name: t.send }) as HTMLButtonElement).hasAttribute('disabled')).toBe(false)
  })
})

describe('No silent truncation — the full history is kept (wave DE)', () => {
  it('a conversation with 60+ messages stays complete — no trimming, no loss', async () => {
    const user = userEvent.setup()
    const longMessages: Message[] = Array.from({ length: 65 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`, `message number ${i}`),
    )
    streamReplyWith('assistant reply sixty six')
    const readState = renderChat([seededConversations(longMessages)[0]])

    // All 65 stored messages are present as rendered bubbles.
    expect(readState()[0].messages).toHaveLength(65)
    expect(screen.getByText('message number 0')).not.toBeNull()
    expect(screen.getByText('message number 64')).not.toBeNull()

    // Sending another message appends without trimming anything: user turn
    // AND assistant reply both commit. (Await the assistant text — unique —
    // since the user text also appears as the sidebar title slice.)
    await user.type(screen.getByRole('textbox', { name: t.chat.placeholder }), 'one more')
    await user.click(screen.getByRole('button', { name: t.send }))
    await screen.findByText('assistant reply sixty six')

    const stored = readState()[0].messages
    expect(stored).toHaveLength(67)
    expect(stored[0].id).toBe('m0')
    expect(stored[64].content).toBe('message number 64')
  })

  it('creating a 51st conversation keeps every older conversation — the cap is gone', async () => {
    const user = userEvent.setup()
    const fifty = Array.from({ length: 50 }, (_, i) => ({
      id: `c${i}`,
      title: `conv ${i}`,
      createdAt: i,
      titleProvisional: false,
      messages: [msg('user', `m-${i}`, `content of conv ${i}`)],
    }))
    streamReplyWith('fifty first assistant reply')
    const readState = renderChat(fifty, null)

    // Sending from the empty state creates a new conversation.
    await user.type(screen.getByRole('textbox', { name: t.chat.placeholder }), 'new conversation body')
    await user.click(screen.getByRole('button', { name: t.send }))
    // Await the assistant reply (unique text) so the send has fully committed.
    await screen.findByText('fifty first assistant reply')

    const stored = readState()
    expect(stored).toHaveLength(51)
    // The new one is newest-first…
    expect(stored[0].messages.some((m) => m.content === 'new conversation body')).toBe(true)
    // …and the OLDEST conversation survived — no silent eviction. Order is
    // newest-first: the new conversation, then the original seed order.
    expect(stored.some((c) => c.id === 'c0')).toBe(true)
    expect(stored[1].id).toBe('c0')
    expect(stored[50].id).toBe('c49')
  })
})

describe('Conversation rename — inline, bilingual, persisted (wave DE)', () => {
  function twoConversations(): Conversation[] {
    return [
      { id: 'conv-1', title: 'first', createdAt: 1, titleProvisional: false, messages: [msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'first reply')] },
      { id: 'conv-2', title: 'second', createdAt: 2, titleProvisional: false, messages: [msg('user', 'n1', 'other conversation')] },
    ]
  }

  function openActionsMenu(): void {
    fireEvent.click(screen.getByRole('button', { name: t.chat.conversationActions }))
  }

  function pickRename(): void {
    fireEvent.click(screen.getByRole('menuitem', { name: t.chat.rename }))
  }

  function renameInput(): HTMLInputElement {
    return screen.getByRole('textbox', { name: t.chat.renameLabel }) as HTMLInputElement
  }

  function renameTo(value: string, settle: 'Enter' | 'Escape' | 'blur' = 'Enter'): void {
    openActionsMenu()
    pickRename()
    const input = renameInput()
    fireEvent.change(input, { target: { value } })
    if (settle === 'Enter') fireEvent.keyDown(input, { key: 'Enter' })
    else if (settle === 'Escape') fireEvent.keyDown(input, { key: 'Escape' })
    else fireEvent.blur(input)
  }

  it('R1: the menu item opens an inline editor pre-filled with the current title', () => {
    renderChat(twoConversations())

    openActionsMenu()
    pickRename()

    const input = renameInput()
    expect(input.value).toBe('first')
    expect(input.getAttribute('dir')).toBe('auto')
    // The editor replaces the title button in place; its delete button is hidden.
    expect(screen.queryByRole('button', { name: 'first' })).toBeNull()
    expect(screen.getAllByRole('button', { name: t.chat.delete })).toHaveLength(1)
  })

  it('R2: Enter commits an English rename — sidebar and state update, title pinned manual', () => {
    const readState = renderChat(twoConversations())

    renameTo('Project plan')

    expect(screen.queryByRole('textbox', { name: t.chat.renameLabel })).toBeNull()
    expect(screen.getByRole('button', { name: 'Project plan' })).not.toBeNull()
    const stored = readState()[0]
    expect(stored.title).toBe('Project plan')
    expect(stored.titleManual).toBe(true)
    expect(stored.titleProvisional).toBe(false)
    // The other conversation is untouched.
    expect(readState()[1].title).toBe('second')
  })

  it('R3: an Arabic rename commits and keeps per-text direction via dir=auto', () => {
    const readState = renderChat(twoConversations())

    renameTo('خطة المشروع')

    expect(screen.getByRole('button', { name: 'خطة المشروع' })).not.toBeNull()
    expect(readState()[0].title).toBe('خطة المشروع')
    expect(readState()[0].titleManual).toBe(true)
  })

  it('R4: Escape cancels — the title stands, nothing is pinned', () => {
    const readState = renderChat(twoConversations())

    renameTo('should not apply', 'Escape')

    expect(screen.queryByRole('textbox', { name: t.chat.renameLabel })).toBeNull()
    expect(screen.getByRole('button', { name: 'first' })).not.toBeNull()
    expect(readState()[0].title).toBe('first')
    expect(readState()[0].titleManual).toBeUndefined()
  })

  it('R5: blur commits a changed title', () => {
    const readState = renderChat(twoConversations())

    renameTo('blurred rename', 'blur')

    expect(readState()[0].title).toBe('blurred rename')
    expect(readState()[0].titleManual).toBe(true)
  })

  it('R6: an empty (whitespace-only) title cancels instead of saving', () => {
    const readState = renderChat(twoConversations())

    renameTo('   ')

    expect(readState()[0].title).toBe('first')
    expect(readState()[0].titleManual).toBeUndefined()
  })

  it('R7: an unchanged title is not pinned as manual', () => {
    const readState = renderChat(twoConversations())

    renameTo('first')

    expect(readState()[0].title).toBe('first')
    expect(readState()[0].titleManual).toBeUndefined()
  })

  it('R8: a title beyond 60 code points is capped without splitting pairs', () => {
    const readState = renderChat(twoConversations())
    const long = 'و'.repeat(65) + '🔥'.repeat(65)

    renameTo(long)

    const stored = readState()[0].title
    expect([...stored].length).toBe(60)
    expect(stored.endsWith('…')).toBe(false)
    // Only whole characters — a split surrogate pair would fail this regex.
    expect(/^و*🔥*$/u.test(stored)).toBe(true)
  })

  it('R9: exports use the renamed title — Markdown heading and JSON body (integration)', async () => {
    const { downloadTextFile } = await import('../lib/conversationExport')
    const downloadMock = vi.mocked(downloadTextFile)
    renderChat(twoConversations())

    renameTo('خطة المشروع')

    openActionsMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: t.chat.exportMarkdown }))
    expect(downloadMock).toHaveBeenCalledTimes(1)
    const [mdName, mdContent] = downloadMock.mock.calls[0]
    expect(mdName).toBe('خطة-المشروع.md')
    expect(mdContent.startsWith('# خطة المشروع')).toBe(true)

    openActionsMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: t.chat.exportJson }))
    const [jsonName, jsonContent] = downloadMock.mock.calls[1]
    expect(jsonName).toBe('خطة-المشروع.json')
    expect((JSON.parse(jsonContent) as { title: string }).title).toBe('خطة المشروع')
  })
})

describe('In-app keyboard shortcuts (wave FG)', () => {
  /** Custom text matcher: the live streaming bubble (same as the S-suite). */
  function streamingBubble(text: string): (content: string, element: Element | null) => boolean {
    return (_content, element) => element?.className === 'bubble assistant' && element.textContent === text
  }

  it('Escape cuts an active stream — same trace as the Stop button — even while the composer is focused', async () => {
    const signals: AbortSignal[] = []
    replyMock.mockImplementation(
      (_thread: ThreadMessage[], onDelta: (t: string) => void, signal: AbortSignal) => {
        signals.push(signal)
        onDelta('partial before escape,')
        return new Promise<'completed' | 'aborted'>((resolve) => {
          signal.addEventListener('abort', () => resolve('aborted'), { once: true })
        })
      },
    )
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'old reply')]))
    const user = userEvent.setup()

    fireEvent.click(regenerateButton())
    await screen.findByText(streamingBubble('partial before escape,'))

    // The functional-exception rule: Escape works while typing in the composer.
    await user.click(screen.getByRole('textbox', { name: t.chat.placeholder }))
    await user.keyboard('{Escape}')

    await waitFor(() => expect(contents(storedMessages(readState))).toEqual(['hello', 'partial before escape,']))
    expect(storedMessages(readState)[1]?.stopped).toBe(true)
    expect(signals[0]?.aborted).toBe(true)
    // A user stop is not a failure — no banner, composer released.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: t.chat.stopGenerating })).toBeNull()
  })

  it('Escape without an active stream is inert — nothing breaks and sending still works', async () => {
    streamReplyWith('a calm reply')
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'old reply')]))
    const user = userEvent.setup()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alert')).toBeNull()

    await user.type(screen.getByRole('textbox', { name: t.chat.placeholder }), 'one more')
    fireEvent.click(screen.getByRole('button', { name: t.send }))
    await screen.findByText('a calm reply')
    expect(contents(storedMessages(readState))).toEqual(['hello', 'old reply', 'one more', 'a calm reply'])
  })

  it('? opens the shortcuts panel, which closes on Escape', async () => {
    renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'old reply')]))
    const user = userEvent.setup()
    expect(screen.queryByRole('dialog', { name: t.chat.shortcuts.title })).toBeNull()

    await user.keyboard('?')
    expect(screen.getByRole('dialog', { name: t.chat.shortcuts.title })).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: t.chat.shortcuts.title })).toBeNull()
  })

  it('a literal ? typed into the composer is text, never the shortcut (and the panel opens from the sidebar kebab)', async () => {
    renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'old reply')]))
    const user = userEvent.setup()
    const composer = screen.getByRole('textbox', { name: t.chat.placeholder })

    await user.click(composer)
    await user.keyboard('hello?')
    expect(screen.queryByRole('dialog', { name: t.chat.shortcuts.title })).toBeNull()
    expect((composer as HTMLTextAreaElement).value).toBe('hello?')

    // The sidebar kebab's «Keyboard shortcuts» item opens the same panel.
    const kebab = screen.getByRole('button', { name: t.chat.moreOptions })
    await user.click(kebab)
    await user.click(screen.getByRole('menuitem', { name: t.chat.shortcuts.title }))
    expect(screen.getByRole('dialog', { name: t.chat.shortcuts.title })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: t.chat.shortcuts.title })).toBeNull()
    // Focus returns to the kebab button that opened the panel.
    expect(document.activeElement).toBe(kebab)
  })
})
