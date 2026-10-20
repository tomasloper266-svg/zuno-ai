// @vitest-environment jsdom
/**
 * Wave-1 design glow-up regression: the completion-pulse hook. The newest
 * assistant reply must carry `.is-latest` (the CSS zuno-complete pulse target);
 * user messages and older assistant replies must never carry it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MessageBubble } from './MessageBubble'
import { strings } from '../i18n/strings'
import type { Message } from '../types'

vi.mock('../lib/markdown', () => ({ renderMarkdown: (content: string) => content }))

const t = strings.en

function msg(role: Message['role'], id: string): Message {
  return { id, role, content: 'hello', ts: 1_700_000_000_000 }
}

afterEach(() => {
  cleanup()
})

describe('MessageBubble is-latest completion-pulse hook', () => {
  it('newest assistant reply carries is-latest (pulse target present)', () => {
    render(<MessageBubble message={msg('assistant', 'a1')} t={t} isLastAssistant onRegenerate={() => {}} />)
    const bubble = document.querySelector('.bubble.assistant')
    expect(bubble).not.toBeNull()
    expect(bubble?.classList.contains('is-latest')).toBe(true)
  })

  it('user bubbles and older assistant replies never carry is-latest', () => {
    render(<MessageBubble message={msg('user', 'u1')} t={t} isLastAssistant={false} onRegenerate={() => {}} />)
    expect(document.querySelector('.bubble.user')?.classList.contains('is-latest')).toBe(false)

    cleanup()
    render(<MessageBubble message={msg('assistant', 'a1')} t={t} isLastAssistant={false} onRegenerate={() => {}} />)
    expect(document.querySelector('.bubble.assistant')?.classList.contains('is-latest')).toBe(false)
  })
})
