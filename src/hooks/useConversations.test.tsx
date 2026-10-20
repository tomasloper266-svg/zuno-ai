// @vitest-environment jsdom
/** Hook-level persistence tests for useConversations (wave DE): corrupt
 * payloads are quarantined (kept for forensics) while the app starts fresh,
 * legacy v1 arrays migrate to the v2 envelope on first mount, a write that
 * hits quota never throws and never loses the stored payload, and a payload
 * stamped by a newer schema version is read but never overwritten. */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useConversations } from './useConversations'
import { CONVERSATIONS_STORAGE_KEY, QUARANTINE_STORAGE_KEY, STORAGE_SCHEMA_VERSION } from '../lib/conversationStorage'
import type { Conversation, Message } from '../types'

function message(id: string, content: string): Message {
  return { id, role: 'user', content, ts: 1_700_000_000_000 }
}

function conversation(id: string): Conversation {
  return { id, title: `conv ${id}`, createdAt: 1, messages: [message(`m-${id}`, 'hello')] }
}

/** Probe rendering the hook's state — the same pattern as the Chat harness. */
function Probe(): React.JSX.Element {
  const [conversations, setConversations, notice] = useConversations()
  return (
    <div>
      <div data-testid="count">{conversations.length}</div>
      <div data-testid="first-title">{conversations[0]?.title ?? ''}</div>
      <div data-testid="notice">{notice ?? ''}</div>
      <button type="button" data-testid="add" onClick={() => setConversations((prev) => [...prev, conversation('new')])}>
        add
      </button>
    </div>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('useConversations — corruption quarantine', () => {
  it('a corrupt payload is moved to the quarantine key and the app starts fresh', () => {
    const corrupt = '{"conversations": [oops'
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, corrupt)

    render(<Probe />)

    expect(screen.getByTestId('count').textContent).toBe('0')
    // The broken bytes are kept for forensics — not silently destroyed…
    expect(window.localStorage.getItem(QUARANTINE_STORAGE_KEY)).toBe(corrupt)
    // …and the main key holds a fresh, valid v2 envelope.
    const fresh = JSON.parse(window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY) ?? 'null') as { schemaVersion: number; conversations: unknown[] }
    expect(fresh.schemaVersion).toBe(STORAGE_SCHEMA_VERSION)
    expect(fresh.conversations).toEqual([])
  })
})

describe('useConversations — v1 → v2 migration', () => {
  it('a legacy bare-array payload migrates to the versioned envelope on first mount', () => {
    const legacy = JSON.stringify([conversation('c1'), conversation('c2')])
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, legacy)

    render(<Probe />)

    expect(screen.getByTestId('count').textContent).toBe('2')
    expect(screen.getByTestId('first-title').textContent).toBe('conv c1')
    const migrated = JSON.parse(window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY) ?? 'null') as { schemaVersion: number; conversations: { id: string }[] }
    expect(migrated.schemaVersion).toBe(STORAGE_SCHEMA_VERSION)
    expect(migrated.conversations.map((c) => c.id)).toEqual(['c1', 'c2'])
  })
})

describe('useConversations — write failures', () => {
  it('a write under quota does not throw, keeps the active conversation in memory, and loses no stored data', () => {
    const legacy = JSON.stringify([conversation('c1')])
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, legacy)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    render(<Probe />)

    // The gentle banner is up; nothing threw; the conversation is live in memory.
    expect(screen.getByTestId('notice').textContent).toBe('save-failed')
    expect(screen.getByTestId('count').textContent).toBe('1')
    // The stored payload was NOT clobbered by the failed write.
    expect(window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY)).toBe(legacy)
  })

  it('the notice clears again after a successful write', () => {
    const legacy = JSON.stringify([conversation('c1')])
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, legacy)
    const failing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })
    render(<Probe />)
    expect(screen.getByTestId('notice').textContent).toBe('save-failed')

    // Space frees up: the next write succeeds and retires the notice.
    failing.mockRestore()
    fireEvent.click(screen.getByTestId('add'))
    expect(screen.getByTestId('notice').textContent).toBe('')
  })
})

describe('useConversations — future schema versions', () => {
  it('a payload stamped by a newer schema version is read cautiously and never overwritten', () => {
    const futureEnvelope = JSON.stringify({
      schemaVersion: STORAGE_SCHEMA_VERSION + 1,
      conversations: [conversation('future-1'), { totallyUnknown: true }],
    })
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, futureEnvelope)

    render(<Probe />)

    // Best-effort read: the valid conversations are usable in memory.
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(screen.getByTestId('first-title').textContent).toBe('conv future-1')

    // And no write path touches the newer payload — even after a state change.
    fireEvent.click(screen.getByTestId('add'))
    expect(window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY)).toBe(futureEnvelope)
  })
})
