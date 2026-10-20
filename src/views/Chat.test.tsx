// @vitest-environment jsdom
/**
 * Component regression suite for the Regenerate one-request invariant
 * (spec art_9nIltQLr §4.3, tests T1–T6).
 *
 * Seam: the REAL `Chat` component rendered through a small harness that mirrors
 * App.tsx's exact wiring (conversations + activeId state, setConversations,
 * onSelect). Only the engine boundary is mocked — `getAssistantReply` via
 * vi.mock/importActual, so `ChatRequestError`, `recentMessagesForRequest` and
 * `IS_DEMO` stay real. Every test drives the real click handlers
 * (Regenerate, banner Retry, Composer Send) — no handler is re-implemented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Chat } from './Chat'
import { ChatRequestError, getAssistantReply } from '../lib/engine'
import { strings } from '../i18n/strings'
import type { Conversation, Message } from '../types'

vi.mock('../lib/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/engine')>()
  return { ...actual, getAssistantReply: vi.fn() }
})

const t = strings.en
const replyMock = vi.mocked(getAssistantReply)

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
    replyMock.mockResolvedValue('regenerated reply')
    const readState = renderChat(seededConversations([msg('user', 'm1', 'hello'), msg('assistant', 'm2', 'first reply')]))

    fireEvent.click(regenerateButton())
    await screen.findByText('regenerated reply')

    expect(replyMock).toHaveBeenCalledTimes(1)
    expect(contents(storedMessages(readState))).toEqual(['hello', 'regenerated reply'])
  })

  it('T2: two rapid clicks in the same tick, before any re-render, start exactly one request', async () => {
    replyMock.mockResolvedValue('regenerated once')
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
    replyMock.mockResolvedValue('fresh reply')
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
    replyMock.mockResolvedValueOnce('recovered reply')
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
    replyMock.mockResolvedValue('demo answer')
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
    let releaseRetry!: (value: string) => void
    replyMock.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseRetry = resolve
        }),
    )
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

    releaseRetry('recovered reply')
    await screen.findByText('recovered reply')

    expect(screen.queryByRole('alert')).toBeNull()
    expect(contents(storedMessages(readState))).toEqual(['hello', 'recovered reply'])
  })
})
