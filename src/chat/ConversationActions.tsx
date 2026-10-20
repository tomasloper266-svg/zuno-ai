import { useEffect, useRef, useState } from 'react'
import type { Conversation } from '../types'
import { conversationToText } from '../lib/conversationText'
import { conversationToJson, conversationToMarkdown, downloadTextFile, exportFilename } from '../lib/conversationExport'
import { copyText } from '../lib/util'
import type { Strings } from '../i18n/strings'

interface ConversationActionsProps {
  t: Strings
  conversation: Conversation | null
  /** Start an inline rename of this conversation in the sidebar. Omit when
   * renaming is unavailable — the menu item then does not render. */
  onRename?: () => void
}

/**
 * Header menu for conversation-level actions (rename, copy, export): one
 * kebab button plus a small popover, closed by outside click or Escape.
 * Renders nothing when there is no conversation to act on.
 */
export function ConversationActions({ t, conversation, onRename }: ConversationActionsProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Outside click and Escape close the open menu (listeners only while open).
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent): void {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (conversation === null || conversation.messages.length === 0) return null

  async function handleCopy(): Promise<void> {
    if (conversation === null) return
    const ok = await copyText(conversationToText(conversation, t.chat.you))
    if (ok) {
      setOpen(false)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  function handleExport(format: 'md' | 'json'): void {
    if (conversation === null) return
    if (format === 'md') {
      downloadTextFile(exportFilename(conversation, 'md'), conversationToMarkdown(conversation, t.chat.you), 'text/markdown')
    } else {
      downloadTextFile(exportFilename(conversation, 'json'), conversationToJson(conversation), 'application/json')
    }
    setOpen(false)
  }

  return (
    <div className="conv-actions" ref={rootRef}>
      <button
        type="button"
        className={`icon-btn${copied ? ' copied' : ''}`}
        aria-label={copied ? t.chat.copied : t.chat.conversationActions}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {copied ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="5.5" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="12" cy="18.5" r="1.7" />
          </svg>
        )}
      </button>
      {open && (
        <div className="conv-menu" role="menu" aria-label={t.chat.conversationActions}>
          {onRename && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onRename()
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4 20h4L19.5 8.5a2.1 2.1 0 00-3-3L5 17v3z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t.chat.rename}
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => void handleCopy()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2.5" />
              <path d="M5.5 14.5A2 2 0 014 12.6V6a2 2 0 012-2h6.6a2 2 0 011.9 1.5" strokeLinecap="round" />
            </svg>
            {t.chat.copyConversation}
          </button>
          <button type="button" role="menuitem" onClick={() => handleExport('md')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 19h14" strokeLinecap="round" />
            </svg>
            {t.chat.exportMarkdown}
          </button>
          <button type="button" role="menuitem" onClick={() => handleExport('json')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 19h14" strokeLinecap="round" />
            </svg>
            {t.chat.exportJson}
          </button>
        </div>
      )}
    </div>
  )
}
