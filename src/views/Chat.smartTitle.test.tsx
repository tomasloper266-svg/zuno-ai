// @vitest-environment jsdom
/** Smart-title wiring regression suite: the /title request fires exactly once
 * per conversation, right after the FIRST exchange commits; success replaces
 * the local heuristic title and pins it; any failure keeps the local title
 * silently; switching conversations aborts the in-flight request.
 * Seam: the real `Chat` through the App-shaped harness. The engine boundary
 * is mocked (streamAssistantReply) and the smart-title module is mocked at its
 * import edge, so the trigger/cancel/attempt bookkeeping under test stays real. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Chat } from './Chat'
import { streamAssistantReply } from '../lib/engine'
import type { ThreadMessage } from '../lib/engine'
import { requestSmartTitle } from '../lib/smartTitle'
import { strings } from '../i18n/strings'
import type { Conversation, Message } from '../types'

vi.mock('../lib/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/engine')>()
  return { ...actual, streamAssistantReply: vi.fn() }
})

vi.mock('../lib/smartTitle', () => ({ requestSmartTitle: vi.fn() }))

const t = strings.en
const replyMock = vi.mocked(streamAssistantReply)
const titleMock = vi.mocked(requestSmartTitle)

/** Default streamed reply: one delta carrying `text`, then a clean completion. */
function streamReplyWith(text: string): void {
  replyMock.mockImplementation(async (_thread: ThreadMessage[], onDelta: (t: string) => void) => {
    onDelta(text)
    return 'completed'
  })
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

async function send(text: string): Promise<void> {
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: t.chat.placeholder }), text)
  await user.click(screen.getByRole('button', { name: t.send }))
}

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('Chat smart-title wiring', () => {
  it('fires exactly once after the first exchange, carrying the first user message and reply', async () => {
    streamReplyWith('Hi! How can I help?')
    titleMock.mockResolvedValue('Greeting Help')
    renderChat(seededConversations([]))

    await send('Hello there')
    await screen.findByText('Hi! How can I help?')

    await waitFor(() => expect(titleMock).toHaveBeenCalledTimes(1))
    expect(titleMock).toHaveBeenCalledWith(
      { user: 'Hello there', assistant: 'Hi! How can I help?' },
      expect.any(AbortSignal),
    )
  })

  it('never fires again for later exchanges in the same conversation', async () => {
    streamReplyWith('second reply')
    titleMock.mockResolvedValue(null)
    renderChat(
      seededConversations([msg('user', 'm1', 'first question'), msg('assistant', 'm2', 'first reply')]),
    )

    await send('follow-up question')
    await screen.findByText('second reply')
    await waitFor(() => expect(replyMock).toHaveBeenCalledTimes(1))
    expect(titleMock).not.toHaveBeenCalled()
  })

  it('on success replaces the local title and pins the conversation as titled', async () => {
    streamReplyWith('Here is the answer')
    titleMock.mockResolvedValue('Async Await Explained')
    const readState = renderChat(seededConversations([]))

    await send('Explain async await')
    await screen.findByText('Here is the answer')

    await waitFor(() => expect(readState()[0].title).toBe('Async Await Explained'))
    expect(readState()[0].titleProvisional).toBe(false)
  })

  it('on failure keeps the local heuristic title — silently, no error UI', async () => {
    streamReplyWith('Here is the answer')
    titleMock.mockResolvedValue(null)
    const readState = renderChat(seededConversations([]))

    await send('Explain async await')
    await screen.findByText('Here is the answer')

    await waitFor(() => expect(titleMock).toHaveBeenCalledTimes(1))
    // The local title derived from the first user message stands — finalized
    // locally by applyDerivedTitle (titleProvisional: false) — and no error UI
    // appears anywhere: a silent feature.
    expect(readState()[0].title).toBe('Explain async await')
    expect(readState()[0].titleProvisional).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('aborts the in-flight smart-title request when the user switches conversations', async () => {
    streamReplyWith('the reply')
    // Holder object: TS control-flow narrowing on a bare `let` assigned only
    // inside a callback collapses reads to `never`; a property read keeps the
    // declared type.
    const captured: { signal: AbortSignal | null } = { signal: null }
    titleMock.mockImplementation(
      (_input, signal) =>
        new Promise<null>(() => {
          captured.signal = signal
        }),
    )
    const seed: Conversation[] = [
      { id: 'conv-1', title: 'first conversation', createdAt: 1, messages: [] },
      { id: 'conv-2', title: 'second conversation', createdAt: 2, messages: [] },
    ]
    renderChat(seed)

    await send('Hello there')
    await waitFor(() => expect(titleMock).toHaveBeenCalledTimes(1))
    expect(captured.signal?.aborted).toBe(false)

    const other = screen.getByRole('button', { name: /second conversation/i })
    const user = userEvent.setup()
    await user.click(other)

    await waitFor(() => expect(captured.signal?.aborted).toBe(true))
  })
})
