import { useEffect, useRef, useState } from 'react'
import { Brand } from '../components/ZunoLogo'
import { IS_DEMO } from '../lib/engine'
import { filterConversations } from '../lib/search'
import { capRenameTitle } from '../lib/title'
import { useMenuFocus } from '../hooks/useMenuFocus'
import type { Conversation } from '../types'
import type { Strings } from '../i18n/strings'

interface SidebarProps {
  t: Strings
  conversations: Conversation[]
  activeId: string | null
  collapsed: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onHome: () => void
  /** Inline rename (from the header actions menu): the row whose title is
   * currently being edited, or null. */
  renamingId?: string | null
  /** Commit a rename — the title is already whitespace-capped and non-empty. */
  onRenameCommit?: (id: string, title: string) => void
  /** Abandon the rename — the current title stands. */
  onRenameCancel?: () => void
  /** One-shot from the launcher deep link (?action=search): focus the search field. */
  autoFocusSearch?: boolean
  /** Acknowledge the focus request so the intent is consumed exactly once. */
  onSearchFocused?: () => void
  /** Open the keyboard-shortcuts panel (the sidebar kebab's menu item). */
  onOpenShortcuts?: () => void
}

export function Sidebar({
  t,
  conversations,
  activeId,
  collapsed,
  onSelect,
  onNew,
  onDelete,
  onHome,
  renamingId = null,
  onRenameCommit = () => {},
  onRenameCancel = () => {},
  autoFocusSearch = false,
  onSearchFocused = () => {},
  onOpenShortcuts = () => {},
}: SidebarProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // The sidebar kebab ("more options"): one menu with app-level items —
  // currently the keyboard-shortcuts panel entry. Same focus management as
  // the header kebab (useMenuFocus), opening upward from the footer.
  const [actionsOpen, setActionsOpen] = useState(false)
  const { rootRef: kebabRootRef, buttonRef: kebabButtonRef, menuRef: kebabMenuRef } = useMenuFocus(
    actionsOpen,
    closeActions,
  )
  const visible = filterConversations(conversations, query)

  function closeActions(refocusButton: boolean): void {
    setActionsOpen(false)
    if (refocusButton) kebabButtonRef.current?.focus()
  }

  /** Settle an inline rename: commit a real change, cancel an empty or
   * unchanged one (an untouched edit must not pin the title as manual). */
  function settleRename(conv: Conversation, raw: string): void {
    const title = capRenameTitle(raw)
    if (title === '' || title === conv.title) onRenameCancel()
    else onRenameCommit(conv.id, title)
  }

  useEffect(() => {
    if (!autoFocusSearch) return
    searchRef.current?.focus()
    onSearchFocused()
  }, [autoFocusSearch, onSearchFocused])

  return (
    <aside className={`chat-sidebar${collapsed ? ' collapsed' : ''}`} inert={collapsed}>
      <div className="sidebar-inner">
        <button type="button" className="sidebar-brand" onClick={onHome} aria-label={t.nav.home}>
          <Brand compact />
        </button>

        <button
          type="button"
          className="new-chat-btn"
          onClick={() => {
            // A fresh conversation is empty — it can never match an active
            // filter, so clear the query or the new chat would look "lost".
            setQuery('')
            onNew()
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          {t.chat.newChat}
        </button>

        <div className="sidebar-search">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.chat.searchPlaceholder}
            aria-label={t.chat.searchPlaceholder}
          />
        </div>

        <span className="sidebar-label">{t.chat.history}</span>
        <nav className="conversation-list" aria-label={t.chat.history}>
          {conversations.length === 0 ? (
            <p className="sidebar-empty">{t.chat.historyEmpty}</p>
          ) : visible.length === 0 ? (
            <p className="sidebar-empty">{t.chat.searchNoResults}</p>
          ) : (
            visible.map((conv) => (
              <div key={conv.id} className={`conversation-item${conv.id === activeId ? ' active' : ''}`}>
                {conv.id === renamingId ? (
                  <input
                    className="conv-rename"
                    dir="auto"
                    defaultValue={conv.title}
                    aria-label={t.chat.renameLabel}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') settleRename(conv, e.currentTarget.value)
                      else if (e.key === 'Escape') onRenameCancel()
                    }}
                    onBlur={(e) => settleRename(conv, e.currentTarget.value)}
                  />
                ) : (
                  <>
                    <button type="button" className="conv-btn" onClick={() => onSelect(conv.id)} title={conv.title}>
                      {conv.title}
                    </button>
                    <button
                      type="button"
                      className="conv-delete"
                      aria-label={t.chat.delete}
                      onClick={() => onDelete(conv.id)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </nav>

        <div className="sidebar-footer">
          {IS_DEMO ? t.footerNote : t.footerNoteLive}
          <span className="sidebar-storage-note">{t.storageLocalNote}</span>
          <div className="sidebar-actions" ref={kebabRootRef}>
            <button
              type="button"
              ref={kebabButtonRef}
              className="icon-btn sidebar-kebab"
              aria-label={t.chat.moreOptions}
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
              onClick={() => (actionsOpen ? closeActions(true) : setActionsOpen(true))}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5.5" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="12" cy="18.5" r="1.7" />
              </svg>
            </button>
            {actionsOpen && (
              <div className="conv-menu sidebar-menu" role="menu" aria-label={t.chat.moreOptions} ref={kebabMenuRef}>
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    // Re-anchor on the kebab button first — the menu item is
                    // about to unmount, and the panel's Escape must have a
                    // living element to return focus to.
                    closeActions(true)
                    onOpenShortcuts()
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <rect x="2.5" y="7" width="19" height="10" rx="2" />
                    <path d="M6.5 10.5h.01M10 10.5h.01M13.5 10.5h.01M17 10.5h.01M6.5 13.5h.01M9.5 13.5h.01M12.5 13.5h.01M15.5 13.5h.01" strokeLinecap="round" />
                  </svg>
                  {t.chat.shortcuts.title}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
