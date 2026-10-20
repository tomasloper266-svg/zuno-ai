// @vitest-environment jsdom
/** ConversationActions: hidden without a conversation; copies the full
 * conversation as labeled text; closes on copy and on Escape. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConversationActions } from './ConversationActions'
import { strings } from '../i18n/strings'
import type { Conversation } from '../types'

// user-event replaces navigator.clipboard with its own stub, so assert on the
// component's actual behavior: it formats the conversation and asks copyText
// (the clipboard boundary) to write it.
vi.mock('../lib/util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/util')>()
  return { ...actual, copyText: vi.fn().mockResolvedValue(true) }
})

const { copyText } = await import('../lib/util')
const copyTextMock = vi.mocked(copyText)

const t = strings.en

const conversation: Conversation = {
  id: 'c1',
  title: 'Debounce in React',
  createdAt: 1_700_000_000_000,
  messages: [
    { id: 'm1', role: 'user', content: 'How do I debounce?', ts: 1 },
    { id: 'm2', role: 'assistant', content: 'Use a timer.', ts: 2 },
  ],
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  copyTextMock.mockClear()
})

describe('ConversationActions', () => {
  it('renders nothing when there is no conversation to act on', () => {
    const { container } = render(<ConversationActions t={t} conversation={null} />)
    expect(container.firstElementChild).toBeNull()
  })

  it('copies the full conversation as labeled text and closes the menu', async () => {
    render(<ConversationActions t={t} conversation={conversation} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: t.chat.conversationActions }))
    await user.click(screen.getByRole('menuitem', { name: t.chat.copyConversation }))
    expect(copyTextMock).toHaveBeenCalledWith('Debounce in React\n\nYou: How do I debounce?\n\nZUNO: Use a timer.')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu on Escape', async () => {
    render(<ConversationActions t={t} conversation={conversation} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: t.chat.conversationActions }))
    expect(screen.getByRole('menu')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
