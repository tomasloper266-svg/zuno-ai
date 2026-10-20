// @vitest-environment jsdom
/** Sidebar search: typing filters the conversation list; a no-match query gets
 * its own empty state; clearing restores the full list. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import { strings } from '../i18n/strings'
import type { Conversation } from '../types'

const t = strings.en

function conv(id: string, title: string, content: string): Conversation {
  return {
    id,
    title,
    createdAt: 1_700_000_000_000,
    messages: [{ id: `${id}-m`, role: 'user', content, ts: 1_700_000_000_000 }],
  }
}

const conversations = [
  conv('c1', 'Debounce in React', 'How do I debounce a function in TypeScript?'),
  conv('c2', 'خطة تعلم البرمجة', 'أريد خطة دراسة لتعلم البرمجة من الصفر'),
]

function renderSidebar(): void {
  render(
    <Sidebar
      t={t}
      conversations={conversations}
      activeId={null}
      collapsed={false}
      onSelect={() => {}}
      onNew={() => {}}
      onDelete={() => {}}
      onHome={() => {}}
    />,
  )
}

afterEach(() => {
  cleanup()
})

describe('Sidebar conversation search', () => {
  it('shows every conversation when the query is empty', async () => {
    renderSidebar()
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox'), 'x')
    await user.clear(screen.getByRole('searchbox'))
    expect(screen.getByText('Debounce in React')).toBeTruthy()
    expect(screen.getByText('خطة تعلم البرمجة')).toBeTruthy()
  })

  it('filters the list down to matching conversations (title or content)', async () => {
    renderSidebar()
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox'), 'debounce')
    expect(screen.getByText('Debounce in React')).toBeTruthy()
    expect(screen.queryByText('خطة تعلم البرمجة')).toBeNull()
  })

  it('shows a dedicated empty state when nothing matches', async () => {
    renderSidebar()
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox'), 'nothing matches this query')
    expect(screen.getByText(t.chat.searchNoResults)).toBeTruthy()
    expect(screen.queryByText('Debounce in React')).toBeNull()
  })

  it('restores the full list after the query is cleared', async () => {
    renderSidebar()
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox'), 'debounce')
    await user.clear(screen.getByRole('searchbox'))
    expect(screen.getByText('Debounce in React')).toBeTruthy()
    expect(screen.getByText('خطة تعلم البرمجة')).toBeTruthy()
  })
})

describe('local-only storage disclosure', () => {
  it('shows the sync disclosure in the sidebar footer (English)', () => {
    renderSidebar()
    expect(screen.getByText(/stored in this browser only and do not sync/i)).not.toBeNull()
  })

  it('shows the Arabic disclosure for Arabic UI strings', () => {
    const tAr = strings.ar
    render(
      <Sidebar
        t={tAr}
        conversations={conversations}
        activeId={null}
        collapsed={false}
        onSelect={() => {}}
        onNew={() => {}}
        onDelete={() => {}}
        onHome={() => {}}
      />,
    )
    expect(screen.getByText('المحادثات محفوظة في هذا المتصفح فقط ولا تنتقل بين الأجهزة.')).not.toBeNull()
  })
})
