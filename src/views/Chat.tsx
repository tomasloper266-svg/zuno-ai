import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Conversation, Message } from '../types'
import { uid } from '../lib/util'
import { getAssistantReply, IS_DEMO } from '../lib/engine'
import type { ThreadMessage } from '../lib/engine'
import { Sidebar } from '../chat/Sidebar'
import { MessageBubble } from '../chat/MessageBubble'
import { Composer } from '../chat/Composer'
import { Brand, ZunoLogo } from '../components/ZunoLogo'
import { Controls } from '../components/Controls'
import type { Lang, Strings } from '../i18n/strings'
import type { Theme } from '../App'

interface ChatProps {
  t: Strings
  lang: Lang
  theme: Theme
  onToggleLang: () => void
  onToggleTheme: () => void
  conversation: Conversation | null
  conversations: Conversation[]
  setConversations: Dispatch<SetStateAction<Conversation[]>>
  onSelect: (id: string) => void
  onNew: () => void
  onHome: () => void
  seedPrompt: string
  onSeedConsumed: () => void
}

export function Chat({
  t,
  lang,
  theme,
  onToggleLang,
  onToggleTheme,
  conversation,
  conversations,
  setConversations,
  onSelect,
  onNew,
  onHome,
  seedPrompt,
  onSeedConsumed,
}: ChatProps): React.JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 820 : false,
  )
  const [pending, setPending] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Stick-to-bottom auto-follow: track whether the reader is near the bottom
  // (direction-independent scrollTop math — identical in LTR and RTL).
  const atBottomRef = useRef(true)
  const justSentRef = useRef(false)
  const prevConvIdRef = useRef<string | null>(conversation?.id ?? null)
  const [atBottom, setAtBottom] = useState(true)
  const [newBelow, setNewBelow] = useState(false)
  const showJump = !atBottom && (pending || newBelow)

  const messages = conversation?.messages ?? []
  const activeConvId = conversation?.id ?? null

  useEffect(() => {
    if (seedPrompt !== '') {
      setDraft(seedPrompt)
      onSeedConsumed()
    }
  }, [seedPrompt, onSeedConsumed])

  useEffect(() => {
    const el = listRef.current
    if (el === null) return
    const switched = prevConvIdRef.current !== activeConvId
    prevConvIdRef.current = activeConvId
    if (switched || justSentRef.current) {
      // Opening a conversation (or just sending) always lands on the newest message.
      justSentRef.current = false
      atBottomRef.current = true
      setAtBottom(true)
      setNewBelow(false)
      el.scrollTo({ top: el.scrollHeight })
      return
    }
    if (atBottomRef.current) {
      // Reader is following the bottom — keep the newest content visible.
      el.scrollTo({ top: el.scrollHeight })
    } else {
      // Reader scrolled up to read history — never drag them down; offer a jump.
      setNewBelow(true)
    }
  }, [activeConvId, messages.length, pending, errorText])

  const NEAR_BOTTOM_PX = 120

  function handleListScroll(): void {
    const el = listRef.current
    if (el === null) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
    atBottomRef.current = near
    setAtBottom(near)
    if (near) setNewBelow(false)
  }

  function jumpToLatest(): void {
    const el = listRef.current
    if (el !== null) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    atBottomRef.current = true
    setAtBottom(true)
    setNewBelow(false)
  }

  function upsertConversation(convId: string, updater: (conv: Conversation) => Conversation): void {
    setConversations((prev) => prev.map((c) => (c.id === convId ? updater(c) : c)))
  }

  function toThread(items: Message[]): ThreadMessage[] {
    return items.map((m) => ({ role: m.role, content: m.content }))
  }

  async function runAssistant(convId: string, thread: ThreadMessage[]): Promise<void> {
    setPending(true)
    setErrorText(null)
    try {
      const reply = await getAssistantReply(thread)
      const assistantMessage: Message = {
        id: uid(),
        role: 'assistant',
        content: reply,
        ts: Date.now(),
        demo: IS_DEMO,
      }
      upsertConversation(convId, (conv) => ({ ...conv, messages: [...conv.messages, assistantMessage] }))
    } catch {
      setErrorText(t.chat.errorBody)
    } finally {
      setPending(false)
    }
  }

  async function send(text: string): Promise<void> {
    const clean = text.trim()
    if (clean === '' || pending) return
    justSentRef.current = true
    const userMessage: Message = { id: uid(), role: 'user', content: clean, ts: Date.now() }
    const baseMessages = conversation?.messages ?? []
    let convId = conversation?.id ?? null

    if (convId === null) {
      convId = uid()
      const conv: Conversation = {
        id: convId,
        title: clean.slice(0, 60),
        createdAt: Date.now(),
        messages: [userMessage],
      }
      setConversations((prev) => [conv, ...prev].slice(0, 50))
      onSelect(convId)
    } else {
      upsertConversation(convId, (conv) => ({ ...conv, messages: [...conv.messages, userMessage] }))
    }

    setDraft('')
    await runAssistant(convId, [...toThread(baseMessages), { role: 'user', content: clean }])
  }

  function retry(): void {
    if (conversation === null || pending || conversation.messages.length === 0) return
    void runAssistant(conversation.id, toThread(conversation.messages))
  }

  function regenerate(): void {
    if (conversation === null || pending) return
    const msgs = [...conversation.messages]
    while (msgs.length > 0 && msgs[msgs.length - 1]?.role === 'assistant') {
      msgs.pop()
    }
    const lastUser = msgs[msgs.length - 1]?.content ?? ''
    if (lastUser === '') return
    upsertConversation(conversation.id, (conv) => ({ ...conv, messages: msgs }))
    void runAssistant(conversation.id, toThread(msgs))
  }

  const isMobile = typeof window !== 'undefined' ? window.innerWidth <= 820 : false

  return (
    <div className="chat">
      {!sidebarCollapsed && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label={t.chat.newChat}
          onClick={() => setSidebarCollapsed(true)}
          tabIndex={-1}
        />
      )}

      <Sidebar
        t={t}
        conversations={conversations}
        activeId={conversation?.id ?? null}
        collapsed={sidebarCollapsed}
        onSelect={(id) => {
          onSelect(id)
          if (isMobile) setSidebarCollapsed(true)
        }}
        onNew={() => {
          onNew()
          setDraft('')
          setErrorText(null)
          if (isMobile) setSidebarCollapsed(true)
        }}
        onDelete={(id) => setConversations((prev) => prev.filter((c) => c.id !== id))}
        onHome={onHome}
      />

      <div className="chat-main">
        <header className="chat-header">
          <button
            type="button"
            className="icon-btn"
            aria-label={t.chat.history}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((prev) => !prev)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" onClick={onHome} aria-label={t.nav.home} style={{ display: 'inline-flex' }}>
            <Brand compact />
          </button>
          <span className="header-spacer" />
          {IS_DEMO && (
            <span className="demo-badge" title={t.chat.demoNote}>
              <span className="dot" />
              {t.chat.demoBadge}
            </span>
          )}
          {!IS_DEMO && (
            <span className="live-badge" title={t.chat.liveNote}>
              <span className="dot" />
              {t.chat.liveBadge}
            </span>
          )}
          <Controls t={t} lang={lang} theme={theme} onToggleLang={onToggleLang} onToggleTheme={onToggleTheme} />
        </header>

        <div
          className="message-list"
          ref={listRef}
          onScroll={handleListScroll}
          tabIndex={0}
          role="region"
          aria-label={t.chat.messagesRegion}
        >
          {messages.length === 0 && errorText === null ? (
            <div className="chat-empty">
              <ZunoLogo size={44} />
              <h2>{t.chat.emptyTitle}</h2>
              <p>{t.chat.emptyHint}</p>
              <div className="empty-chips">
                {t.entries.map((entry) => (
                  <button key={entry.id} type="button" className="empty-chip" onClick={() => setDraft(entry.prompt)}>
                    {entry.title}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list-inner">
              {messages.map((message, i) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  t={t}
                  isLastAssistant={message.role === 'assistant' && i === messages.length - 1 && !pending}
                  onRegenerate={regenerate}
                />
              ))}
              {errorText !== null && (
                <div className="chat-error" role="alert">
                  <span>
                    {t.chat.errorTitle} — {errorText}
                  </span>
                  <button type="button" onClick={retry}>
                    {t.chat.retry}
                  </button>
                </div>
              )}
              {pending && (
                <div className="bubble-row assistant">
                  <span className="avatar assistant" aria-hidden="true">
                    <ZunoLogo size={20} />
                  </span>
                  <div className="bubble assistant typing" aria-label={IS_DEMO ? t.chat.demoBadge : t.chat.liveBadge}>
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {showJump && (
            <button type="button" className="jump-latest" onClick={jumpToLatest}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t.chat.jumpToLatest}
            </button>
          )}
          <Composer t={t} value={draft} onChange={setDraft} onSend={(v) => void send(v)} disabled={pending} />
          {!IS_DEMO && (
            <p className="privacy-note" dir="auto">
              {t.chat.privacyNote}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
