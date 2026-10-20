import { describe, expect, it } from 'vitest'
import { filterConversations, normalizeForSearch } from './search'
import type { Conversation, Message } from '../types'

function msg(content: string): Message {
  return { id: `m-${content}`, role: 'user', content, ts: 1_700_000_000_000 }
}

function conv(title: string, contents: string[]): Conversation {
  return {
    id: `c-${title}`,
    title,
    createdAt: 1_700_000_000_000,
    messages: contents.map(msg),
  }
}

const conversations = [
  conv('Debounce in React', ['How do I debounce a function in TypeScript?']),
  conv('خطة تعلّم البرمجة', ['أريد خطة دراسة لتعلّم البرمجة من الصفر خطوة بخطوة']),
]

describe('filterConversations', () => {
  it('returns every conversation for an empty or whitespace query', () => {
    expect(filterConversations(conversations, '')).toEqual(conversations)
    expect(filterConversations(conversations, '   ')).toEqual(conversations)
  })

  it('matches on the title, case-insensitively', () => {
    const matches = filterConversations(conversations, 'DEBOUNCE')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.title).toBe('Debounce in React')
  })

  it('matches inside message content, not just titles', () => {
    const matches = filterConversations(conversations, 'typescript')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.title).toBe('Debounce in React')
  })

  it('matches Arabic text despite hamza, taa-marbuta, and diacritic spelling', () => {
    // "البرمجه" (plain ha) matches "البرمجة" (taa marbuta); "تعلّم" carries a
    // diacritic the query omits.
    const byTitle = filterConversations(conversations, 'البرمجه')
    expect(byTitle).toHaveLength(1)
    expect(byTitle[0]?.title).toBe('خطة تعلّم البرمجة')

    const byContent = filterConversations(conversations, 'دراسه')
    expect(byContent).toHaveLength(1)
    expect(byContent[0]?.title).toBe('خطة تعلّم البرمجة')
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterConversations(conversations, 'quantum physics')).toEqual([])
  })

  it('keeps the original newest-first order of matches', () => {
    const both = [
      conv('first', ['needle here']),
      conv('second', ['nothing relevant']),
      conv('third', ['another needle']),
    ]
    expect(filterConversations(both, 'needle').map((c) => c.title)).toEqual(['first', 'third'])
  })
})

describe('normalizeForSearch', () => {
  it('lowercases and strips Arabic diacritics and tatweel', () => {
    // Shadda (ّ) and tatweel (ـ) are invisible to the matcher.
    expect(normalizeForSearch('تعلّـم')).toBe('تعلم')
  })

  it('unifies hamza forms, taa marbuta, and alef maqsura', () => {
    expect(normalizeForSearch('أ إ آ ٱ ة ى')).toBe('ا ا ا ا ه ي')
  })
})
