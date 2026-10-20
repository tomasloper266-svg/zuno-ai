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
// (the clipboard boundary) to write it. downloadTextFile is stubbed for the
// same reason — the formatters themselves are covered in conversationExport.test.ts.
vi.mock('../lib/util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/util')>()
  return { ...actual, copyText: vi.fn().mockResolvedValue(true) }
})
vi.mock('../lib/conversationExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/conversationExport')>()
  return { ...actual, downloadTextFile: vi.fn() }
})

const { copyText } = await import('../lib/util')
const copyTextMock = vi.mocked(copyText)
const { downloadTextFile } = await import('../lib/conversationExport')
const downloadMock = vi.mocked(downloadTextFile)

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
  downloadMock.mockClear()
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

  it('exports the conversation as Markdown and closes the menu', async () => {
    render(<ConversationActions t={t} conversation={conversation} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: t.chat.conversationActions }))
    await user.click(screen.getByRole('menuitem', { name: t.chat.exportMarkdown }))
    const [filename, content, mime] = downloadMock.mock.calls[0] ?? []
    expect(filename?.endsWith('.md')).toBe(true)
    expect(content).toContain('# Debounce in React')
    expect(mime).toBe('text/markdown')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('exports the conversation as lossless JSON and closes the menu', async () => {
    render(<ConversationActions t={t} conversation={conversation} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: t.chat.conversationActions }))
    await user.click(screen.getByRole('menuitem', { name: t.chat.exportJson }))
    const [filename, content, mime] = downloadMock.mock.calls[0] ?? []
    expect(filename?.endsWith('.json')).toBe(true)
    expect(JSON.parse(content ?? '{}')).toEqual(conversation)
    expect(mime).toBe('application/json')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ConversationActions menu focus management (WAI-ARIA menu pattern)', () => {
  it('exposes the menu contract: haspopup + expanded on the button, menu/menuitem roles, items out of the tab order', async () => {
    render(<ConversationActions t={t} conversation={conversation} onRename={() => {}} />)
    const button = screen.getByRole('button', { name: t.chat.conversationActions })
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    const user = userEvent.setup()
    await user.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem')
    expect(items.length).toBeGreaterThanOrEqual(3)
    for (const item of items) {
      expect((item as HTMLElement).getAttribute('tabindex')).toBe('-1')
    }
    // Opening hands focus to the first item.
    expect(document.activeElement).toBe(items[0])
  })

  it('ArrowDown/ArrowUp cycle the items with wrap-around; Home/End jump to the ends', async () => {
    render(<ConversationActions t={t} conversation={conversation} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: t.chat.conversationActions }))
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[1])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[2])
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(items[1])
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(items[0])
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(items[2]) // wraps to the last item
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(items[2])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[0]) // wraps to the first item
  })

  it('Escape closes the menu and returns focus to the kebab button itself', async () => {
    render(<ConversationActions t={t} conversation={conversation} />)
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: t.chat.conversationActions })
    await user.click(button)
    await user.keyboard('{ArrowDown}') // focus travels into the menu first
    expect(document.activeElement).not.toBe(button)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('Tab inside the menu is logically contained: it closes and re-anchors on the kebab button, no random trap', async () => {
    render(<ConversationActions t={t} conversation={conversation} />)
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: t.chat.conversationActions })
    await user.click(button)
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Tab}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
    // Shift+Tab behaves the same way.
    await user.click(button)
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('selecting an item closes the menu and refocuses the kebab button', async () => {
    render(<ConversationActions t={t} conversation={conversation} />)
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: t.chat.conversationActions })
    await user.click(button)
    await user.click(screen.getByRole('menuitem', { name: t.chat.copyConversation }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('behaves identically in RTL: open to the first item, arrows move, Escape returns to the button', async () => {
    document.documentElement.dir = 'rtl'
    try {
      const ar = strings.ar
      render(<ConversationActions t={ar} conversation={conversation} />)
      const user = userEvent.setup()
      const button = screen.getByRole('button', { name: ar.chat.conversationActions })
      await user.click(button)
      const items = screen.getAllByRole('menuitem')
      expect(document.activeElement).toBe(items[0])
      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(items[1])
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(button)
    } finally {
      document.documentElement.dir = ''
    }
  })
})
