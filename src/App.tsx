import { useCallback, useEffect, useMemo, useState } from 'react'
import { Home } from './views/Home'
import { Chat } from './views/Chat'
import { strings } from './i18n/strings'
import type { Lang } from './i18n/strings'
import { useLocalStorage } from './hooks/useLocalStorage'
import { useConversations } from './hooks/useConversations'
import { parseLaunchAction, stripLaunchAction } from './pwa/launchIntent'

export type Theme = 'dark' | 'light'
export type View = 'home' | 'chat'

function defaultLang(): Lang {
  try {
    return navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en'
  } catch {
    return 'en'
  }
}

export default function App(): React.JSX.Element {
  const [lang, setLang] = useLocalStorage<Lang>('zuno.lang', defaultLang())
  const [theme, setTheme] = useLocalStorage<Theme>('zuno.theme', 'dark')
  const [view, setView] = useState<View>('home')
  // Versioned, corruption-tolerant persistence (quarantine on bad JSON,
  // v1→v2 migration, no silent data loss on quota) + a gentle save-failure
  // notice rendered as a banner below.
  const [conversations, setConversations, storageNotice] = useConversations()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [seedPrompt, setSeedPrompt] = useState('')
  // One-shot flag behind the launcher search deep link (?action=search).
  const [searchFocusPending, setSearchFocusPending] = useState(false)

  const t = strings[lang]
  const active = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggleLang = useCallback(() => setLang((prev) => (prev === 'en' ? 'ar' : 'en')), [setLang])
  const toggleTheme = useCallback(() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')), [setTheme])

  const startChat = useCallback(
    (prompt = '') => {
      setSeedPrompt(prompt)
      setActiveId(null)
      setView('chat')
    },
    [],
  )
  const openChat = useCallback((id: string) => {
    setActiveId(id)
    setSeedPrompt('')
    setView('chat')
  }, [])
  const newChat = useCallback(() => {
    setActiveId(null)
    setSeedPrompt('')
  }, [])
  const consumeSeed = useCallback(() => setSeedPrompt(''), [])
  const goHome = useCallback(() => setView('home'), [])

  const onSearchFocused = useCallback(() => setSearchFocusPending(false), [])

  // Launcher deep links (PWA shortcuts): execute once at mount, then strip the
  // parameter from the URL so a reload or a shared link never re-triggers it.
  useEffect(() => {
    const action = parseLaunchAction(window.location.search)
    if (action === null) return
    window.history.replaceState(null, '', stripLaunchAction(window.location.href))
    if (action.kind === 'new-chat') {
      startChat()
      return
    }
    // Search: the conversation list only exists in the chat view — open the
    // most recent conversation (or a fresh one) with the search field focused.
    if (conversations.length > 0) openChat(conversations[0].id)
    else startChat()
    setSearchFocusPending(true)
    // Mount-only by design: a deep link is a launch-time instruction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (view === 'home') {
    return (
      <Home
        t={t}
        lang={lang}
        theme={theme}
        onToggleLang={toggleLang}
        onToggleTheme={toggleTheme}
        onStart={startChat}
      />
    )
  }

  return (
    <>
      {storageNotice !== null && (
        <div className="storage-notice" role="status">
          {t.storageNotice}
        </div>
      )}
      <Chat
        t={t}
        lang={lang}
        theme={theme}
        onToggleLang={toggleLang}
        onToggleTheme={toggleTheme}
        conversation={active}
        conversations={conversations}
        setConversations={setConversations}
        onSelect={openChat}
        onNew={newChat}
        onHome={goHome}
        seedPrompt={seedPrompt}
        onSeedConsumed={consumeSeed}
        searchFocusPending={searchFocusPending}
        onSearchFocused={onSearchFocused}
      />
    </>
  )
}
