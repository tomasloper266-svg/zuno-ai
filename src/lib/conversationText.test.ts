import { describe, expect, it } from 'vitest'
import { conversationToText } from './conversationText'
import type { Conversation, Message } from '../types'

function message(id: string, role: Message['role'], content: string, seeded = false): Message {
  return { id, role, content, ts: 1_700_000_000_000, ...(seeded ? { seeded: true } : {}) }
}

const conversation: Conversation = {
  id: 'c1',
  title: 'Debounce in React',
  createdAt: 1_700_000_000_000,
  messages: [
    message('m0', 'assistant', "Hello! I'm ZUNO. How can I help you today?", true),
    message('m1', 'user', 'How do I debounce a function?'),
    message('m2', 'assistant', 'Here is a small **debounce** hook.'),
  ],
}

describe('conversationToText', () => {
  it('labels user messages with the localized you-label and assistant messages with the brand', () => {
    const text = conversationToText(conversation, 'أنت')
    expect(text).toContain('أنت: How do I debounce a function?')
    expect(text).toContain('ZUNO: Here is a small **debounce** hook.')
  })

  it('starts with the title, then a blank line', () => {
    expect(conversationToText(conversation, 'You').split('\n\n')[0]).toBe('Debounce in React')
  })

  it('separates messages with blank lines and includes the seeded greeting', () => {
    const text = conversationToText(conversation, 'You')
    const lines = text.split('\n\n')
    expect(lines).toHaveLength(4)
    expect(lines[1]).toBe("ZUNO: Hello! I'm ZUNO. How can I help you today?")
  })

  it('renders a title-only text for an empty conversation', () => {
    const empty: Conversation = { ...conversation, messages: [] }
    expect(conversationToText(empty, 'You')).toBe('Debounce in React')
  })
})
