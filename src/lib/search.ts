import type { Conversation } from '../types'

/**
 * Client-side search across saved conversations — titles and message contents,
 * straight from localStorage. No network, no index: the store is capped at 50
 * conversations, so a linear scan is instant.
 */

/**
 * Normalize text for matching: lowercase, strip Arabic diacritics (tashkeel)
 * and tatweel, and unify letter variants that differ only in dots/hamza —
 * أ إ آ ٱ → ا, ة → ه, ى → ي — so Arabic queries match regardless of how the
 * author spelled the hamza or taa marbuta. Pure.
 */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // tashkeel, dagger alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
}

function conversationHaystack(conv: Conversation): string {
  return normalizeForSearch([conv.title, ...conv.messages.map((m) => m.content)].join('\n'))
}

/** Conversations whose title or any message content matches the query, in their
 * original (newest-first) order. An empty or whitespace-only query returns
 * everything — no filtering. Pure. */
export function filterConversations(conversations: Conversation[], query: string): Conversation[] {
  const needle = normalizeForSearch(query).trim()
  if (needle === '') return conversations
  return conversations.filter((conv) => conversationHaystack(conv).includes(needle))
}
