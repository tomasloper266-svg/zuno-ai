import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  CONVERSATIONS_STORAGE_KEY,
  QUARANTINE_STORAGE_KEY,
  parseConversations,
  serializeConversations,
} from '../lib/conversationStorage'
import type { Conversation } from '../types'

/**
 * Conversations state with versioned, corruption-tolerant persistence — the
 * hardened replacement for `useLocalStorage<Conversation[]>` on the
 * conversations key. Same state shape as before, so App wiring is unchanged,
 * plus a gentle one-time notice for storage failures.
 *
 * On mount it reads defensively (see lib/conversationStorage): a corrupt
 * payload is moved to a quarantine key for forensics and the app starts
 * fresh; a legacy v1 payload (bare array) is migrated to the versioned v2
 * envelope in place; a payload written by a NEWER schema version is read
 * cautiously and never overwritten by this build.
 */

export type StorageNotice = 'save-failed'

export function useConversations(): [Conversation[], Dispatch<SetStateAction<Conversation[]>>, StorageNotice | null] {
  const [saveFailed, setSaveFailed] = useState<StorageNotice | null>(null)

  const [boot] = useState(() => {
    let raw: string | null = null
    try {
      raw = window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY)
    } catch {
      /* storage unavailable — treat as empty; the write path reports the failure */
    }
    const parsed = parseConversations(raw)
    if (parsed.quarantined && raw !== null) {
      // Keep the corrupt bytes under the quarantine key for forensics instead
      // of deleting them, then start fresh. Best effort — quarantine must
      // never be the thing that breaks the app.
      try {
        window.localStorage.setItem(QUARANTINE_STORAGE_KEY, raw)
        window.localStorage.removeItem(CONVERSATIONS_STORAGE_KEY)
      } catch {
        /* ignore — a stuck quarantine is the smaller failure */
      }
    }
    return { conversations: parsed.conversations, isFutureVersion: parsed.isFutureVersion }
  })

  const [conversations, setConversations] = useState<Conversation[]>(boot.conversations)

  useEffect(() => {
    // Data stamped by a newer schema version is never overwritten by this
    // build — in-memory use still works, the stored payload stays intact.
    if (boot.isFutureVersion) return
    try {
      // First run migrates a legacy v1 payload in place (eager migration).
      window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, serializeConversations(conversations))
      // A successful write retires a previous save-failure notice.
      setSaveFailed(null)
    } catch {
      // Quota exceeded / storage unavailable: no throw escapes — the in-memory
      // conversation state is intact, and the UI surfaces one gentle notice.
      setSaveFailed('save-failed')
    }
  }, [conversations, boot.isFutureVersion])

  return [conversations, setConversations, saveFailed]
}
