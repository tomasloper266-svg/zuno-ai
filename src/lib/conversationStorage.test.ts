// Pure regression suite for the versioned, corruption-tolerant conversation
// storage (wave DE): corrupt JSON is quarantined, legacy v1 arrays migrate,
// malformed entries are dropped without losing their neighbors, and a payload
// written by a NEWER schema version is read cautiously and never wiped.
import { describe, expect, it } from 'vitest'
import {
  STORAGE_SCHEMA_VERSION,
  parseConversations,
  serializeConversations,
} from './conversationStorage'
import type { Conversation, Message } from '../types'

function message(id: string, content: string, role: Message['role'] = 'user'): Message {
  return { id, role, content, ts: 1_700_000_000_000 }
}

function conversation(id: string, messages: Message[], title = 'conv'): Conversation {
  return { id, title, createdAt: 1, messages }
}

describe('parseConversations — corrupt payloads', () => {
  it('a corrupt JSON payload is quarantined, not wiped, and nothing is thrown', () => {
    const parsed = parseConversations('{"conversations": [oohps')
    expect(parsed.quarantined).toBe(true)
    expect(parsed.conversations).toEqual([])
  })

  it('a JSON value of an impossible shape (plain string) is quarantined too', () => {
    const parsed = parseConversations('"just a string"')
    expect(parsed.quarantined).toBe(true)
  })

  it('absent or empty storage reads as empty without quarantine', () => {
    expect(parseConversations(null)).toMatchObject({ conversations: [], quarantined: false, storedVersion: 0 })
    expect(parseConversations('')).toMatchObject({ conversations: [], quarantined: false })
  })
})

describe('parseConversations — legacy v1 migration', () => {
  it('a bare legacy array migrates successfully with all conversations intact', () => {
    const legacy = JSON.stringify([
      conversation('c1', [message('m1', 'hello')], 'first'),
      conversation('c2', [message('m2', 'مرحبا', 'assistant')], 'ثانية'),
    ])
    const parsed = parseConversations(legacy)
    expect(parsed.quarantined).toBe(false)
    expect(parsed.storedVersion).toBe(1)
    expect(parsed.conversations.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(parsed.conversations[1].title).toBe('ثانية')
  })

  it('migration preserves message ids, order, and extra flags verbatim', () => {
    const legacy = JSON.stringify([
      {
        ...conversation('c1', [message('a', 'one'), message('b', 'two', 'assistant')]),
        titleProvisional: false,
        titleManual: true,
      },
    ])
    const parsed = parseConversations(legacy)
    expect(parsed.conversations[0].messages.map((m) => m.id)).toEqual(['a', 'b'])
    expect(parsed.conversations[0].titleManual).toBe(true)
    expect(parsed.conversations[0].titleProvisional).toBe(false)
  })
})

describe('parseConversations — shape validation', () => {
  it('a conversation with a broken identity (missing id) is dropped, the rest kept', () => {
    const list = [
      { title: 'no id', createdAt: 1, messages: [] },
      conversation('c2', [message('m1', 'kept')], 'kept conv'),
    ]
    const parsed = parseConversations(JSON.stringify(list))
    expect(parsed.droppedConversations).toBe(1)
    expect(parsed.conversations.map((c) => c.id)).toEqual(['c2'])
  })

  it('a malformed message is dropped WITHOUT dropping its conversation or siblings', () => {
    const conv = {
      ...conversation('c1', []),
      messages: [
        message('m1', 'good'),
        { id: 'm2', role: 'wizard', content: 'bad role' }, // unknown role
        { id: 'm3', role: 'user', content: 42 }, // content not a string
        { role: 'user', content: 'no id or ts' },
        message('m5', 'also good', 'assistant'),
      ],
    }
    const parsed = parseConversations(JSON.stringify([conv]))
    expect(parsed.quarantined).toBe(false)
    expect(parsed.droppedMessages).toBe(3)
    expect(parsed.droppedConversations).toBe(0)
    expect(parsed.conversations[0].messages.map((m) => m.id)).toEqual(['m1', 'm5'])
  })

  it('a non-finite ts or createdAt fails validation (NaN payloads)', () => {
    const bad = { ...conversation('c1', []), createdAt: Number.NaN }
    expect(parseConversations(JSON.stringify([bad])).droppedConversations).toBe(1)
    const badMessage = { ...message('m1', 'x'), ts: Number.NaN }
    const conv = conversation('c2', [badMessage])
    const parsed = parseConversations(JSON.stringify([conv]))
    expect(parsed.conversations[0].messages).toEqual([])
    expect(parsed.droppedMessages).toBe(1)
  })
})

describe('parseConversations — future schema versions', () => {
  it('a payload stamped with a NEWER version is read cautiously and flagged, never wiped', () => {
    const future = JSON.stringify({
      schemaVersion: STORAGE_SCHEMA_VERSION + 1,
      conversations: [conversation('c1', [message('m1', 'from the future')], 'future conv')],
    })
    const parsed = parseConversations(future)
    expect(parsed.isFutureVersion).toBe(true)
    expect(parsed.quarantined).toBe(false)
    // Read best-effort: the conversations are still usable in memory.
    expect(parsed.conversations[0].title).toBe('future conv')
    // And the raw payload survives untouched — no rewrite path touches it.
    expect(JSON.parse(future).schemaVersion).toBe(STORAGE_SCHEMA_VERSION + 1)
  })
})

describe('serializeConversations — envelope round-trip', () => {
  it('the current version writes the v2 envelope and round-trips losslessly', () => {
    const convs = [conversation('c1', [message('m1', 'مرحبا'), message('m2', 'hello', 'assistant')], 'عنوان')]
    const raw = serializeConversations(convs)
    expect(JSON.parse(raw).schemaVersion).toBe(STORAGE_SCHEMA_VERSION)
    const parsed = parseConversations(raw)
    expect(parsed.storedVersion).toBe(STORAGE_SCHEMA_VERSION)
    expect(parsed.isFutureVersion).toBe(false)
    expect(parsed.quarantined).toBe(false)
    expect(parsed.conversations).toEqual(convs)
  })
})
