import type { Conversation, Message } from '../types'

/**
 * Versioned, corruption-tolerant persistence for conversations.
 *
 * Stored shapes, oldest first:
 *  - v1 (implicit): a bare JSON array of conversations — what versions of the
 *    app before this module wrote.
 *  - v2 (current): `{ schemaVersion: 2, conversations: [...] }`.
 *
 * Reading is defensive: a corrupt payload is quarantined (reported, kept for
 * forensics by the caller) instead of silently lost, conversations with a
 * broken identity are dropped, and malformed messages are dropped WITHOUT
 * dropping their conversation. Writing always stamps the current version.
 */

export const STORAGE_SCHEMA_VERSION = 2

/** localStorage key — unchanged since v1 so existing data migrates in place. */
export const CONVERSATIONS_STORAGE_KEY = 'zuno.conversations.v1'

/** Where a corrupt payload is moved for forensics before starting fresh. */
export const QUARANTINE_STORAGE_KEY = 'zuno.conversations.v1.quarantine'

export interface ParsedConversations {
  conversations: Conversation[]
  /** Version stamped on the stored payload (0 = absent or unreadable). */
  storedVersion: number
  /** The payload could not be parsed at all — corrupt beyond recovery. */
  quarantined: boolean
  /** The payload was written by a NEWER schema version than this build knows. */
  isFutureVersion: boolean
  /** Conversation entries dropped for a broken identity (id/title/createdAt). */
  droppedConversations: number
  /** Malformed message entries dropped, summed across conversations. */
  droppedMessages: number
}

function emptyParsed(): ParsedConversations {
  return { conversations: [], storedVersion: 0, quarantined: false, isFutureVersion: false, droppedConversations: 0, droppedMessages: 0 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMessageShaped(value: unknown): value is Message {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' && value.id !== '' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    typeof value.ts === 'number' && Number.isFinite(value.ts)
  )
}

function isConversationShaped(value: unknown): value is Conversation & { messages: unknown[] } {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' && value.id !== '' &&
    typeof value.title === 'string' &&
    typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) &&
    Array.isArray(value.messages)
  )
}

/** Validate a list of conversation entries: keep the well-shaped ones, drop
 * broken conversations entirely, and drop only their malformed messages.
 * Message order and ids pass through untouched. Pure. */
function validateList(list: unknown[]): Pick<ParsedConversations, 'conversations' | 'droppedConversations' | 'droppedMessages'> {
  const conversations: Conversation[] = []
  let droppedConversations = 0
  let droppedMessages = 0
  for (const entry of list) {
    if (!isConversationShaped(entry)) {
      droppedConversations += 1
      continue
    }
    const messages: Message[] = []
    for (const message of entry.messages) {
      if (isMessageShaped(message)) messages.push(message)
      else droppedMessages += 1
    }
    // Keep every other stored field verbatim (demo/seeded/stopped/… flags and
    // any future field) — validation guards the core shape, it does not trim.
    conversations.push({ ...entry, messages })
  }
  return { conversations, droppedConversations, droppedMessages }
}

/**
 * Read the persisted payload defensively. Never throws; a payload that cannot
 * be parsed at all comes back `quarantined: true` with empty conversations —
 * the CALLER decides what happens to the corrupt bytes (the hook moves them
 * to the quarantine key rather than deleting them). A payload stamped with a
 * newer schema version is still read (best effort) and flagged so the caller
 * can refrain from overwriting it. Pure.
 */
export function parseConversations(raw: string | null): ParsedConversations {
  const parsed = emptyParsed()
  if (raw === null || raw.trim() === '') return parsed

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ...parsed, quarantined: true }
  }

  if (Array.isArray(data)) {
    // Legacy v1 shape: a bare array of conversations.
    return { ...parsed, ...validateList(data), storedVersion: 1 }
  }
  if (isRecord(data)) {
    const version = typeof data.schemaVersion === 'number' && Number.isFinite(data.schemaVersion) ? data.schemaVersion : 0
    const list = Array.isArray(data.conversations) ? data.conversations : []
    return {
      ...parsed,
      ...validateList(list),
      storedVersion: version,
      isFutureVersion: version > STORAGE_SCHEMA_VERSION,
    }
  }
  // A JSON value of any other shape (string, number…) is corrupt beyond repair.
  return { ...parsed, quarantined: true }
}

/** Wrap the conversations in the versioned envelope. Pure. */
export function serializeConversations(conversations: Conversation[]): string {
  return JSON.stringify({ schemaVersion: STORAGE_SCHEMA_VERSION, conversations })
}
