import type { Conversation } from '../types'

/** Assistant role label in copied/exported text — the brand name in both
 * languages (MessageBubble renders the ZUNO logo for assistant turns). */
const ASSISTANT_NAME = 'ZUNO'

/**
 * Format the full conversation as plain text for the clipboard: the title,
 * then every message prefixed with its role label, separated by blank lines.
 * The seeded greeting is display content the reader actually saw, so it is
 * included. Pure.
 */
export function conversationToText(conv: Conversation, youLabel: string): string {
  const parts = [
    conv.title,
    ...conv.messages.map((m) => `${m.role === 'user' ? youLabel : ASSISTANT_NAME}: ${m.content}`),
  ]
  return parts.join('\n\n')
}
