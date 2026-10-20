import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Conversation, Message } from '../types'
import { uid } from '../lib/util'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { renderMarkdown } from '../lib/markdown'
import { recentMessagesForRequest, IS_DEMO, SENT_MESSAGE_LIMIT, streamAssistantReply, ChatRequestError } from '../lib/engine'
import { MAX_MESSAGE_CHARS } from '../lib/limits'
import type { ChatErrorKind, ThreadMessage } from '../lib/engine'
import { applyDerivedTitle, capRenameTitle } from '../lib/title'
import { requestSmartTitle } from '../lib/smartTitle'
import { Sidebar } from '../chat/Sidebar'
import { ConfirmDeleteDialog } from '../chat/ConfirmDeleteDialog'
import { ShortcutsDialog } from '../chat/ShortcutsDialog'
import { MessageBubble } from '../chat/MessageBubble'
import { ConversationActions } from '../chat/ConversationActions'
import { Composer } from '../chat/Composer'
import { Brand, ZunoLogo } from '../components/ZunoLogo'
import { Controls } from '../components/Controls'
import { isTypingTarget } from '../lib/util'
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
  /** One-shot launcher deep link (?action=search): focus the sidebar search. */
  searchFocusPending?: boolean
  /** Acknowledge the focus request (consumed by the Sidebar). */
  onSearchFocused?: () => void
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
  searchFocusPending = false,
  onSearchFocused = () => {},
}: ChatProps): React.JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 820 : false,
  )
  const [pending, setPending] = useState(false)
  const [errorKind, setErrorKind] = useState<ChatErrorKind | null>(null)
  // Snapshot taken at the moment the request failed — the banner must tell the
  // truth about the failure, not about wherever connectivity stands now.
  const [offlineAtError, setOfflineAtError] = useState(false)
  const [contextTrimmed, setContextTrimmed] = useState(false)
  const [draft, setDraft] = useState('')
  // Pending delete awaiting confirmation — the id of the conversation the user
  // asked to delete, or null when no dialog is open.
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  // The button that opened the delete dialog, so a cancel can return focus there.
  const deleteOpenerRef = useRef<HTMLElement | null>(null)
  // The reply being streamed in: accumulated text plus the conversation it
  // belongs to, so the growing bubble only renders in its own conversation.
  const [streamText, setStreamText] = useState('')
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Collapses smooth scrolling (the jump-to-latest pill) into instant jumps
  // when the OS prefers reduced motion. Read once per mount; the hook keeps
  // it live via the media query's change event.
  const reducedMotion = useReducedMotion()
  // AbortController of the in-flight stream — the stop button's handle.
  const abortRef = useRef<AbortController | null>(null)
  // Synchronous in-flight guard shared by send/retry/regenerate — a plain ref,
  // not React state: it reads back true in the same tick it is set, so a second
  // activation arriving before React re-renders (stale closure, dispatch storm,
  // future non-standard path) can never start a second chat request.
  const inFlightRef = useRef(false)

  // Smart title (ChatGPT-style): at most ONE /title attempt per conversation,
  // ever — ref-tracked so a retry/regenerate of the first exchange can never
  // re-fire it. The controller is the in-flight request's cancel handle
  // (aborted on conversation switch / new chat / leaving the view).
  const smartTitleAttemptedRef = useRef<Set<string>>(new Set())
  const smartTitleAbortRef = useRef<AbortController | null>(null)

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

  // Banner copy: offline failure gets its own truthful message — the generic
  // connection copy would undersell what happened.
  const bannerCopy =
    errorKind === null
      ? null
      : errorKind === 'connection' && offlineAtError
        ? t.chat.offline
        : t.chat.errors[errorKind]

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
    setOfflineAtError(false)
    setContextTrimmed(false)
  }, [activeConvId])

  // Switching conversations (or starting a new one, or leaving the view)
  // cancels the in-flight smart-title request of the conversation being left —
  // the local title stands; the silent feature never speaks across
  // conversation boundaries.
  useEffect(() => {
    return () => {
      smartTitleAbortRef.current?.abort()
    }
  }, [activeConvId])

  // The search deep link must reach a visible sidebar: on a narrow screen the
  // sidebar mounts collapsed, so expand it before the focus lands.
  useEffect(() => {
    if (searchFocusPending) setSidebarCollapsed(false)
  }, [searchFocusPending])

  // In-app keyboard shortcuts, made discoverable in the shortcuts panel
  // (ShortcutsDialog — opened by ? or the sidebar kebab's menu item).
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // The element focus returns to when the panel closes: whatever had focus at
  // open time (the sidebar kebab after a menu-item open, or the previously
  // focused control for a ?-key open).
  const shortcutsOpenerRef = useRef<HTMLElement | null>(null)

  // Stable identity: only refs and the state setter are touched, so the
  // ?-listener effect can subscribe once per modal-state change.
  const openShortcuts = useCallback((): void => {
    shortcutsOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setShortcutsOpen(true)
  }, [])

  function closeShortcuts(): void {
    setShortcutsOpen(false)
    shortcutsOpenerRef.current?.focus()
    shortcutsOpenerRef.current = null
  }

  // Escape cuts the in-flight stream — the same trace as the Stop button (the
  // engine resolves 'aborted' and whatever text arrived is committed). It is
  // the one shortcut that stays live while typing. When a modal is open
  // (delete dialog, shortcuts panel) that modal owns Escape instead.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      if (deleteTargetId !== null || shortcutsOpen) return
      if (!inFlightRef.current || abortRef.current === null) return
      abortRef.current.abort()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [deleteTargetId, shortcutsOpen])

  // ? opens the shortcuts panel — never while typing (a literal ? is a
  // character in the composer, not a command) and never while a modal is
  // already up.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== '?') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      if (deleteTargetId !== null || shortcutsOpen) return
      openShortcuts()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [deleteTargetId, shortcutsOpen, openShortcuts])

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
    // Reduced motion collapses the animation into an instant jump.
    if (el !== null) el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' })
    atBottomRef.current = true
    setAtBottom(true)
    setNewBelow(false)
  }

  /** Cut the in-flight stream now: the engine resolves 'aborted' and whatever
   * text already arrived is committed as the (partial) reply. */
  function stopGenerating(): void {
    abortRef.current?.abort()
  }

  /** Open the delete confirmation dialog for a conversation — never delete on
   * the first click. The trigger button is remembered so a cancel returns
   * focus to it. */
  function requestDelete(id: string): void {
    deleteOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDeleteTargetId(id)
  }

  function closeDeleteDialog(): void {
    setDeleteTargetId(null)
    // Refocus the opener after a cancel; after a real delete the row (and its
    // button) is gone, so the focus() call is a harmless no-op.
    deleteOpenerRef.current?.focus()
    deleteOpenerRef.current = null
  }

  function confirmDelete(): void {
    const id = deleteTargetId
    if (id === null) return
    // Deleting the conversation that is currently streaming aborts its stream:
    // a clean cancel — the engine resolves 'aborted' and the guarded commit
    // no-ops against the removed id, leaving no stuck generating state.
    if (id === streamingConvId) abortRef.current?.abort()
    setConversations((prev) => prev.filter((c) => c.id !== id))
    closeDeleteDialog()
  }

  // Inline rename: the kebab menu's "Rename" item turns the sidebar row's
  // title into an input (Commit = Enter or blur, Cancel = Escape).
  const [renamingId, setRenamingId] = useState<string | null>(null)

  function startRename(id: string): void {
    setRenamingId(id)
    // On a narrow screen the sidebar is collapsed — the inline editor must be
    // visible for the edit to be understandable.
    if (sidebarCollapsed) setSidebarCollapsed(false)
  }

  function commitRename(id: string, raw: string): void {
    setRenamingId(null)
    // An empty title is not a title — cancel instead of saving it.
    const title = capRenameTitle(raw)
    if (title === '') return
    // A manual rename is pinned: titleProvisional:false finalizes the local
    // title and titleManual:true bars every automatic title (heuristic and
    // smart) from ever overwriting the user's word.
    upsertConversation(id, (conv) => ({ ...conv, title, titleProvisional: false, titleManual: true }))
  }

  function upsertConversation(convId: string, updater: (conv: Conversation) => Conversation): void {
    setConversations((prev) => prev.map((c) => (c.id === convId ? updater(c) : c)))
  }

  /** Fire the one-shot smart-title request for `convId`. At most one attempt
   * per conversation (smartTitleAttemptedRef); on success the model title
   * replaces the heuristic one and is pinned (titleProvisional=false); on any
   * failure, timeout, or cancel nothing changes and nothing is shown — a
   * silent feature. */
  function requestSmartTitleFor(convId: string, firstUser: string, firstAssistant: string): void {
    if (smartTitleAttemptedRef.current.has(convId)) return
    smartTitleAttemptedRef.current.add(convId)
    const controller = new AbortController()
    smartTitleAbortRef.current = controller
    void requestSmartTitle({ user: firstUser, assistant: firstAssistant }, controller.signal).then(
      (title) => {
        if (title === null || controller.signal.aborted) return
        // A manual rename (titleManual) outranks the smart title — it may
        // land while the request is in flight, so the response is discarded.
        upsertConversation(convId, (conv) =>
          conv.titleManual === true ? conv : { ...conv, title, titleProvisional: false },
        )
      },
    )
  }

  function toThread(items: Message[]): ThreadMessage[] {
    // The seeded greeting is app-authored display copy, not a model turn —
    // it never enters the thread (which also keeps threads user-first).
    return items
      .filter((m) => !m.seeded)
      .map((m) => ({ role: m.role, content: m.content }))
  }

  async function runAssistant(convId: string, thread: ThreadMessage[], replaceMessageId?: string): Promise<void> {
    // Check-and-set happens synchronously, before any await or state update —
    // the one-request invariant does not rely on React's flush timing.
    if (inFlightRef.current) return
    inFlightRef.current = true
    setPending(true)
    setErrorKind(null)
    setOfflineAtError(false)
    setStreamText('')
    setStreamingConvId(convId)
    // Request-time trim only: the stored history keeps every message — just the
    // newest ones ride on the wire.
    const { messages, trimmed } = recentMessagesForRequest(thread)
    setContextTrimmed(trimmed)
    // text mirrors the accumulated stream server-side — the final committed
    // message content never reads React state back.
    let text = ''
    // True when the reply about to be committed is the conversation's FIRST —
    // exactly the moment the smart title is generated (once per conversation;
    // a retry of a failed first exchange still counts as the first reply).
    const isFirstReply = !thread.some((m) => m.role === 'assistant')
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
        // Completed, stopped midway, or watchdog-cancelled midway: the text the
        // reader saw is the text that gets committed — truthful in all three.
        // Cut-short replies carry `stopped` so the bubble shows the badge. A
        // failed-message retry replaces it in place (same stable id).
        const assistantMessage: Message = {
          id: replaceMessageId ?? uid(),
          role: 'assistant',
          content: text,
          ts: Date.now(),
          demo: IS_DEMO,
          ...(outcome !== 'completed' ? { stopped: true } : {}),
        }
        // One atomic state update: commit the reply AND swap the provisional
        // title for the heuristic one (no-op once the title is finalized).
        upsertConversation(convId, (conv) =>
          applyDerivedTitle({
            ...conv,
            messages: replaceMessageId
              ? conv.messages.map((m) => (m.id === replaceMessageId ? assistantMessage : m))
              : [...conv.messages, assistantMessage],
          }),
        )
        if (isFirstReply) {
          // ChatGPT-style: generate the smart title from the first exchange
          // (first user message + this reply). Fire-and-forget — on any
          // failure the local title stands silently.
          const firstUser = thread.find((m) => m.role === 'user')?.content ?? ''
          requestSmartTitleFor(convId, firstUser, text)
        }
      } else if (outcome === 'completed' || outcome === 'watchdog') {
        // No reply text at all: an empty completion, or a stream the stall
        // watchdog auto-cancelled before the first delta — either way a
        // recovery banner, never silence.
        setErrorKind('service')
      }
    } catch (err) {
      if (text.length > 0) {
        // Mid-stream failure with text already shown: the partial the reader
        // saw is salvaged as a FAILED message — never lost. Its own badge and
        // per-message retry replace the global banner; a zero-text failure
        // keeps the banner (below).
        const failedMessage: Message = {
          id: replaceMessageId ?? uid(),
          role: 'assistant',
          content: text,
          ts: Date.now(),
          demo: IS_DEMO,
          failed: true,
        }
        upsertConversation(convId, (conv) =>
          applyDerivedTitle({
            ...conv,
            messages: replaceMessageId
              ? conv.messages.map((m) => (m.id === replaceMessageId ? failedMessage : m))
              : [...conv.messages, failedMessage],
          }),
        )
      } else {
        // Only genuine network failures carry kind 'connection' — every other path
        // (quota, burst, service fault) is classified by the engine and told truthfully.
        setErrorKind(err instanceof ChatRequestError ? err.kind : 'service')
        setOfflineAtError(typeof navigator !== 'undefined' && !navigator.onLine)
      }
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
    if (clean.length > MAX_MESSAGE_CHARS) return // the composer counter explains; never send over-limit
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
      // The full history is kept — NO silent truncation of older
      // conversations (the audit's no-silent-loss rule). Storage pressure, if
      // it ever materializes, surfaces through the save-failure notice rather
      // than invisible deletion.
      setConversations((prev) => [conv, ...prev])
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

  /** Re-run a failed reply in place: same thread prefix, same message id — the
   * salvaged partial is replaced, never duplicated. */
  function retryFailedMessage(messageId: string): void {
    if (conversation === null || pending || inFlightRef.current) return
    const idx = conversation.messages.findIndex((m) => m.id === messageId)
    if (idx === -1) return
    void runAssistant(conversation.id, toThread(conversation.messages.slice(0, idx)), messageId)
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

  // Characters the next request would carry besides the draft (same filter +
  // slice as the real thread) — the composer's request-total gauge.
  const threadCharCount =
    conversation === null
      ? 0
      : toThread(conversation.messages)
          .slice(-SENT_MESSAGE_LIMIT)
          .reduce((sum, m) => sum + m.content.length, 0)

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
        autoFocusSearch={searchFocusPending}
        onSearchFocused={onSearchFocused}
        onOpenShortcuts={openShortcuts}
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
        onDelete={requestDelete}
        renamingId={renamingId}
        onRenameCommit={commitRename}
        onRenameCancel={() => setRenamingId(null)}
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
          <ConversationActions
            t={t}
            conversation={conversation}
            onRename={conversation === null ? undefined : () => startRename(conversation.id)}
          />
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
                  onRetry={() => retryFailedMessage(message.id)}
                />
              ))}
              {bannerCopy !== null && (
                <div className="chat-error" role="alert">
                  <span>
                    {bannerCopy.title} — {bannerCopy.body}
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
            threadChars={threadCharCount}
          />
          {!IS_DEMO && (
            <p className="privacy-note" dir="auto">
              {t.chat.privacyNote}
            </p>
          )}
        </div>
      </div>

      {deleteTargetId !== null && <ConfirmDeleteDialog t={t} onConfirm={confirmDelete} onCancel={closeDeleteDialog} />}
      {shortcutsOpen && <ShortcutsDialog t={t} onClose={closeShortcuts} />}
    </div>
  )
}
