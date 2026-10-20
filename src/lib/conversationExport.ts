import type { Conversation } from '../types'
import { ASSISTANT_NAME } from './conversationText'

/**
 * Client-side export of the current conversation — Markdown and JSON files
 * generated in the browser and downloaded via a Blob. No network, no server.
 */

/**
 * Format the full conversation as Markdown: an H1 title, then each message as
 * a bold role label with its content below — content kept verbatim, since it
 * is already Markdown as rendered in the bubble. Turns are separated by a
 * horizontal rule. Pure.
 */
export function conversationToMarkdown(conv: Conversation, youLabel: string): string {
  const parts = [`# ${conv.title}`]
  if (conv.messages.length > 0) {
    const blocks = conv.messages.map((m) => {
      const who = m.role === 'user' ? youLabel : ASSISTANT_NAME
      return `**${who}:**\n\n${m.content}`
    })
    parts.push(blocks.join('\n\n---\n\n'))
  }
  return parts.join('\n\n')
}

/** The stored conversation shape, pretty-printed — lossless and re-importable. */
export function conversationToJson(conv: Conversation): string {
  return JSON.stringify(conv, null, 2)
}

/**
 * A safe cross-platform filename from the conversation title: whitespace
 * collapses to dashes, path-unsafe characters are dropped, Arabic letters are
 * kept (modern filesystems handle them fine), capped at 40 code points so a
 * surrogate pair never splits mid-character. Pure.
 */
export function exportFilename(conv: Conversation, ext: 'md' | 'json'): string {
  const base = conv.title
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|]/g, '')
  const capped = [...base].slice(0, 40).join('')
  const safe = capped.replace(/^-+|-+$/g, '')
  return `${safe === '' ? 'conversation' : safe}.${ext}`
}

/** Trigger a browser download of a text file: Blob + object URL + synthetic
 * anchor click. No network involved. */
export function downloadTextFile(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // The click has registered the download; release the object URL afterwards.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
