// @vitest-environment jsdom
/** Export formatters: Markdown structure, lossless JSON, safe filenames, and
 * the Blob-based download trigger. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { conversationToJson, conversationToMarkdown, downloadTextFile, exportFilename } from './conversationExport'
import type { Conversation, Message } from '../types'

function message(id: string, role: Message['role'], content: string): Message {
  return { id, role, content, ts: 1_700_000_000_000 }
}

const conversation: Conversation = {
  id: 'c1',
  title: 'Debounce in React',
  createdAt: 1_700_000_000_000,
  messages: [
    message('m1', 'user', 'How do I **debounce** a function?'),
    message('m2', 'assistant', 'Use a timer:\n\n```ts\ndebounce(fn, 250)\n```'),
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('conversationToMarkdown', () => {
  it('opens with the title as an H1', () => {
    expect(conversationToMarkdown(conversation, 'You').startsWith('# Debounce in React\n\n')).toBe(true)
  })

  it('labels each turn with a bold role and keeps content verbatim', () => {
    const md = conversationToMarkdown(conversation, 'You')
    expect(md).toContain('**You:**\n\nHow do I **debounce** a function?')
    expect(md).toContain('**ZUNO:**\n\nUse a timer:')
    // Content is embedded as-is, code fence included.
    expect(md).toContain('```ts\ndebounce(fn, 250)\n```')
  })

  it('separates turns with a horizontal rule — none after the last turn', () => {
    const md = conversationToMarkdown(conversation, 'You')
    expect(md.match(/---/g)).toHaveLength(1)
    expect(md.endsWith('```')).toBe(true)
  })

  it('renders a title-only document for an empty conversation', () => {
    const empty: Conversation = { ...conversation, messages: [] }
    expect(conversationToMarkdown(empty, 'You')).toBe('# Debounce in React')
  })

  it('uses the localized you-label for Arabic', () => {
    expect(conversationToMarkdown(conversation, 'أنت')).toContain('**أنت:**')
  })
})

describe('conversationToJson', () => {
  it('round-trips to exactly the stored conversation', () => {
    expect(JSON.parse(conversationToJson(conversation))).toEqual(conversation)
  })

  it('pretty-prints with two-space indent', () => {
    expect(conversationToJson(conversation).split('\n')[1]?.startsWith('  "id"')).toBe(true)
  })
})

describe('exportFilename', () => {
  it('collapses whitespace to dashes and appends the extension', () => {
    expect(exportFilename({ ...conversation, title: 'My two  part title' }, 'md')).toBe('My-two-part-title.md')
  })

  it('drops path-unsafe characters', () => {
    expect(exportFilename({ ...conversation, title: 'a/b:c*d?"e"<f>|' }, 'json')).toBe('abcdef.json')
  })

  it('caps the base at 40 code points without splitting a surrogate pair', () => {
    const title = '🙂'.repeat(50)
    const name = exportFilename({ ...conversation, title }, 'md')
    const base = name.slice(0, -3)
    expect([...base].length).toBeLessThanOrEqual(40)
    expect([...base].every((ch) => ch === '🙂')).toBe(true)
  })

  it('falls back to "conversation" when the title leaves nothing usable', () => {
    expect(exportFilename({ ...conversation, title: '   ' }, 'md')).toBe('conversation.md')
    expect(exportFilename({ ...conversation, title: '***' }, 'json')).toBe('conversation.json')
  })
})

describe('downloadTextFile', () => {
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url')
  const revokeObjectURL = vi.fn()
  // jsdom defines click() on HTMLElement.prototype (inherited by anchors) —
  // spying there is the only place the interception actually catches the call.
  // Fresh spy per test: the file-level restoreAllMocks would otherwise restore
  // a module-scope spy back to the real click before this test runs.
  let click: MockInstance<() => void>

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
    click = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {})
  })

  it('creates a Blob URL, clicks a download anchor, and revokes the URL', async () => {
    downloadTextFile('chat.md', '# hi', 'text/markdown')
    const blob = createObjectURL.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('text/markdown')
    expect(click).toHaveBeenCalledTimes(1)
    // The revoke is deferred by setTimeout(0) inside downloadTextFile — let it fire.
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
