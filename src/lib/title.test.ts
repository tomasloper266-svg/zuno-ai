import { describe, expect, it } from 'vitest'
import { applyDerivedTitle, capRenameTitle, deriveTitle, RENAME_MAX_CHARS } from './title'
import type { Conversation, Message } from '../types'

function userMessage(content: string): Message {
  return { id: 'u1', role: 'user', content, ts: 1_700_000_000_000 }
}

function assistantMessage(content: string): Message {
  return { id: 'a1', role: 'assistant', content, ts: 1_700_000_000_001 }
}

describe('deriveTitle', () => {
  it('keeps a short message as-is, with whitespace collapsed', () => {
    expect(deriveTitle('  Hello   world  ')).toBe('Hello world')
  })

  it('returns empty string for empty or whitespace-only input', () => {
    expect(deriveTitle('')).toBe('')
    expect(deriveTitle('   \n\t  ')).toBe('')
  })

  it('cuts long English text on a word boundary and marks it with an ellipsis', () => {
    const text = 'Explain how async await works in TypeScript with a practical example and the common pitfalls'
    const title = deriveTitle(text)
    expect(title.endsWith('…')).toBe(true)
    const cut = title.slice(0, -1)
    // The cut is a whole-word prefix of the original: it starts the text and
    // every kept word is complete.
    expect(text.startsWith(cut)).toBe(true)
    for (const word of cut.split(' ')) expect(text).toContain(word)
    expect([...cut].length).toBeLessThanOrEqual(48)
  })

  it('cuts long Arabic text on a word boundary — never a broken RTL word', () => {
    const text =
      'شرح مفصل لكيفية بناء واجهة مستخدم ثنائية الاتجاه تدعم العربية والإنجليزية مع حفظ المحادثات محليًا داخل المتصفح'
    const title = deriveTitle(text)
    expect(title.endsWith('…')).toBe(true)
    const cut = title.slice(0, -1)
    expect(text.startsWith(cut)).toBe(true)
    // Every kept word is a whole word of the original — no mid-word cut.
    for (const word of cut.split(' ')) expect(text).toContain(word)
    expect([...cut].length).toBeLessThanOrEqual(48)
    expect(cut.split(' ').length).toBeGreaterThan(1)
  })

  it('counts code points, so surrogate pairs (emoji) never split mid-character', () => {
    const text = '🙂'.repeat(60)
    const title = deriveTitle(text)
    expect(title.endsWith('…')).toBe(true)
    const cut = [...title.slice(0, -1)]
    expect(cut.length).toBeLessThanOrEqual(48)
    expect(cut.every((ch) => ch === '🙂')).toBe(true)
  })

  it('hard-cuts a single word longer than the cap (no boundary available)', () => {
    expect(deriveTitle('a'.repeat(80))).toBe(`${'a'.repeat(48)}…`)
  })
})

describe('capRenameTitle (manual rename)', () => {
  it('keeps a short Arabic title verbatim, with whitespace collapsed', () => {
    expect(capRenameTitle('  خطة\tتعلّم  البرمجة ')).toBe('خطة تعلّم البرمجة')
  })

  it('caps at 60 code points without appending an ellipsis', () => {
    const long = 'شرح مفصّل لكيفية عمل الذاكرة المؤقتة في المتصفحات وتأثيرها على الأداء العام'
    const capped = capRenameTitle(long)
    expect([...capped].length).toBeLessThanOrEqual(RENAME_MAX_CHARS)
    expect(capped.endsWith('…')).toBe(false)
    expect(long.startsWith(capped)).toBe(true)
  })

  it('never splits a surrogate pair when capping (emoji count as one code point)', () => {
    const emojiTitle = '🔥'.repeat(70)
    const capped = capRenameTitle(emojiTitle)
    expect([...capped].length).toBe(RENAME_MAX_CHARS)
    // Every kept character is a full emoji — no lone halves.
    expect(capped.replace(/🔥/gu, '')).toBe('')
  })

  it('returns empty for empty or whitespace-only input — the caller cancels', () => {
    expect(capRenameTitle('')).toBe('')
    expect(capRenameTitle('   \n  ')).toBe('')
  })
})

describe('applyDerivedTitle', () => {
  function provisionalConv(firstUserContent: string, titleProvisional?: boolean): Conversation {
    return {
      id: 'c1',
      title: firstUserContent.slice(0, 60),
      createdAt: 1_700_000_000_000,
      titleProvisional,
      messages: [userMessage(firstUserContent), assistantMessage('Sure — here is how it works.')],
    }
  }

  it('sets the heuristic title when the first reply commits', () => {
    const conv = provisionalConv('Help me with this code: explain how debounce works in TypeScript with an example')
    const titled = applyDerivedTitle(conv)
    expect(titled.title).toBe(deriveTitle(conv.messages[0]?.content ?? ''))
    expect(titled.titleProvisional).toBe(false)
    // Messages pass through untouched.
    expect(titled.messages).toEqual(conv.messages)
  })

  it('upgrades legacy conversations (field undefined) on their next reply', () => {
    const legacy = provisionalConv('ساعدني في كتابة خطة دراسة لتعلم البرمجة من الصفر خطوة بخطوة بالتفصيل الممل')
    expect(legacy.titleProvisional).toBeUndefined()
    const titled = applyDerivedTitle(legacy)
    expect(titled.titleProvisional).toBe(false)
    expect(titled.title).toBe(deriveTitle(legacy.messages[0]?.content ?? ''))
  })

  it('leaves an already-finalized conversation unchanged (same object)', () => {
    const conv: Conversation = { ...provisionalConv('Short question'), title: 'kept', titleProvisional: false }
    expect(applyDerivedTitle(conv)).toBe(conv)
  })

  it('never re-titles a manually-renamed conversation', () => {
    const conv: Conversation = { ...provisionalConv('Long question that would derive a different title'), title: 'اسمي الخاص', titleProvisional: false, titleManual: true }
    const retitled = applyDerivedTitle(conv)
    expect(retitled.title).toBe('اسمي الخاص')
    expect(retitled.titleProvisional).toBe(false)
  })
})
