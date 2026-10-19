import { Brand } from '../components/ZunoLogo'
import { IS_DEMO } from '../lib/engine'
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
}: SidebarProps): React.JSX.Element {
  return (
    <aside className={`chat-sidebar${collapsed ? ' collapsed' : ''}`} inert={collapsed}>
      <div className="sidebar-inner">
        <button type="button" className="sidebar-brand" onClick={onHome} aria-label={t.nav.home}>
          <Brand compact />
        </button>

        <button type="button" className="new-chat-btn" onClick={onNew}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          {t.chat.newChat}
        </button>

        <span className="sidebar-label">{t.chat.history}</span>
        <nav className="conversation-list" aria-label={t.chat.history}>
          {conversations.length === 0 ? (
            <p className="sidebar-empty">{t.chat.historyEmpty}</p>
          ) : (
            conversations.map((conv) => (
              <div key={conv.id} className={`conversation-item${conv.id === activeId ? ' active' : ''}`}>
                <button type="button" className="conv-btn" onClick={() => onSelect(conv.id)} title={conv.title}>
                  {conv.title}
                </button>
                <button type="button" className="conv-delete" aria-label={t.chat.delete} onClick={() => onDelete(conv.id)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </nav>

        <div className="sidebar-footer">{IS_DEMO ? t.footerNote : t.footerNoteLive}</div>
      </div>
    </aside>
  )
}
