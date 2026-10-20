import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Conversation, Message } from '../types'
import { uid } from '../lib/util'
import { renderMarkdown } from '../lib/markdown'
import { recentMessagesForRequest, IS_DEMO, streamAssistantReply, ChatRequestError } from '../lib/engine'
import type { ChatErrorKind, ThreadMessage } from '../lib/engine'
import { applyDerivedTitle } from '../lib/title'
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
  const [errorKind, setErrorKind] = useState<ChatErrorKind | null>(null)
  const [contextTrimmed, setContextTrimmed] = useState(false)
  const [draft, setDraft] = useState('')
  // The reply being streamed in: accumulated text plus the conversation it
  // belongs to, so the growing bubble only renders in its own conversation.
  const [streamText, setStreamText] = useState('')
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // AbortController of the in-flight stream — the stop button's handle.
  const abortRef = useRef<AbortController | null>(null)
  // Synchronous in-flight guard shared by send/retry/regenerate — a plain ref,
  // not React state: it reads back true in the same tick it is set, so a second
  // activation arriving before React re-renders (stale closure, dispatch storm,
  // future non-standard path) can never start a second chat request.
  const inFlightRef = useRef(false)

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
  }, [activeConvId, messages.length, pending, errorKind, streamText])

  // A trimmed-context notice describes one conversation's request, like an error
  // banner does — switching conversations or starting a new chat clears both.
  useEffect(() => {
    setErrorKind(null)
    setContextTrimmed(false)
  }, [activeConvId])

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

  /** Cut the in-flight stream now: the engine resolves 'aborted' and whatever
   * text already arrived is committed as the (partial) reply. */
  function stopGenerating(): void {
    abortRef.current?.abort()
  }

  function upsertConversation(convId: string, updater: (conv: Conversation) => Conversation): void {
    setConversations((prev) => prev.map((c) => (c.id === convId ? updater(c) : c)))
  }

  function toThread(items: Message[]): ThreadMessage[] {
    // The seeded greeting is app-authored display copy, not a model turn —
    // it never enters the thread (which also keeps threads user-first).
    return items
      .filter((m) => !m.seeded)
      .map((m) => ({ role: m.role, content: m.content }))
  }

  async function runAssistant(convId: string, thread: ThreadMessage[]): Promise<void> {
    // Check-and-set happens synchronously, before any await or state update —
    // the one-request invariant does not rely on React's flush timing.
    if (inFlightRef.current) return
    inFlightRef.current = true
    setPending(true)
    setErrorKind(null)
    setStreamText('')
    setStreamingConvId(convId)
    // Request-time trim only: the stored history keeps every message — just the
    // newest ones ride on the wire.
    const { messages, trimmed } = recentMessagesForRequest(thread)
    setContextTrimmed(trimmed)
    // text mirrors the accumulated stream server-side — the final committed
    // message content never reads React state back.
    let text = ''
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const outcome = await streamAssistantReply(
        messages,
        (delta) => {
          text += delta
          setStreamText(text)
        },
        controller.signal,
      )
      if (text.length > 0) {
        // Completed or stopped midway: the text the reader saw is the text that
        // gets committed — truthful in both cases.
        const assistantMessage: Message = {
          id: uid(),
          role: 'assistant',
          content: text,
          ts: Date.now(),
          demo: IS_DEMO,
        }
        // One atomic state update: commit the reply AND swap the provisional
        // title for the heuristic one (no-op once the title is finalized).
        upsertConversation(convId, (conv) =>
          applyDerivedTitle({ ...conv, messages: [...conv.messages, assistantMessage] }),
        )
      } else if (outcome === 'completed') {
        // The stream finished but carried no reply text at all.
        setErrorKind('service')
      }
    } catch (err) {
      // Only genuine network failures carry kind 'connection' — every other path
      // (quota, burst, service fault) is classified by the engine and told truthfully.
      setErrorKind(err instanceof ChatRequestError ? err.kind : 'service')
    } finally {
      abortRef.current = null // released even on error, so retry stays usable
      inFlightRef.current = false
      setPending(false)
      setStreamText('')
      setStreamingConvId(null)
    }
  }

  async function send(text: string): Promise<void> {
    const clean = text.trim()
    if (clean === '' || pending || inFlightRef.current) return
    justSentRef.current = true
    const now = Date.now()
    const userMessage: Message = { id: uid(), role: 'user', content: clean, ts: now }
    const baseMessages = conversation?.messages ?? []
    let convId = conversation?.id ?? null

    if (convId === null) {
      convId = uid()
      const greeting: Message = {
        id: uid(),
        role: 'assistant',
        content: t.chat.greeting,
        ts: now,
        seeded: true,
      }
      const conv: Conversation = {
        id: convId,
        title: clean.slice(0, 60),
        createdAt: now,
        // Provisional creation-time slice — replaced by the heuristic title
        // (lib/title) the moment the first reply completes.
        titleProvisional: true,
        // The greeting is seeded HERE, at creation, as the first message:
        // insertion order is the ordering source of truth, so a new
        // conversation always opens with it (no render-time re-ordering).
        messages: [greeting, userMessage],
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
    if (conversation === null || pending || inFlightRef.current || conversation.messages.length === 0) return
    void runAssistant(conversation.id, toThread(conversation.messages))
  }

  function regenerate(): void {
    // In-flight check MUST precede the history pop: a swallowed duplicate
    // activation must never mutate the conversation.
    if (conversation === null || pending || inFlightRef.current) return
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
          setErrorKind(null)
          setContextTrimmed(false)
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
          {messages.length === 0 && errorKind === null ? (
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
              {errorKind !== null && (
                <div className="chat-error" role="alert">
                  <span>
                    {t.chat.errors[errorKind].title} — {t.chat.errors[errorKind].body}
                  </span>
                  <button type="button" onClick={retry} disabled={pending}>
                    {t.chat.retry}
                  </button>
                </div>
              )}
              {pending && streamingConvId === activeConvId && streamText === '' && (
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
              {pending && streamingConvId === activeConvId && streamText !== '' && (
                <div className="bubble-row assistant">
                  <span className="avatar assistant" aria-hidden="true">
                    <ZunoLogo size={20} />
                  </span>
                  <div className="bubble assistant" dir="auto" aria-label={IS_DEMO ? t.chat.demoBadge : t.chat.liveBadge}>
                    {renderMarkdown(streamText)}
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
          {!IS_DEMO && contextTrimmed && (
            <p className="chat-context-note" role="note" dir="auto">
              {t.chat.contextTrimmed}
            </p>
          )}
          <Composer
            t={t}
            value={draft}
            onChange={setDraft}
            onSend={(v) => void send(v)}
            disabled={pending}
            streaming={pending}
            onStop={stopGenerating}
          />
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
