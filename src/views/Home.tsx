import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Brand } from '../components/ZunoLogo'
import { Controls } from '../components/Controls'
import { NodeField } from '../components/NodeField'
import type { Lang, Strings } from '../i18n/strings'
import type { Theme } from '../App'

interface HomeProps {
  t: Strings
  lang: Lang
  theme: Theme
  onToggleLang: () => void
  onToggleTheme: () => void
  onStart: (prompt?: string) => void
}

export function Home({ t, lang, theme, onToggleLang, onToggleTheme, onStart }: HomeProps): React.JSX.Element {
  const [value, setValue] = useState('')

  function submit(event: FormEvent): void {
    event.preventDefault()
    onStart(value)
  }

  const headline = t.headline
  const accent = t.headlineAccentWord
  const accentIndex = headline.lastIndexOf(accent)
  const title: ReactNode =
    accentIndex === -1 ? (
      headline
    ) : (
      <>
        {headline.slice(0, accentIndex)}
        <span className="accent">{accent}</span>
        {headline.slice(accentIndex + accent.length)}
      </>
    )

  return (
    <div className="home">
      <NodeField />
      <header className="home-topbar">
        <Brand />
        <Controls t={t} lang={lang} theme={theme} onToggleLang={onToggleLang} onToggleTheme={onToggleTheme} />
      </header>

      <main className="home-hero">
        <span className="tagline-pill">
          <span className="dot" />
          {t.tagline}
        </span>
        <h1>{title}</h1>
        <p className="home-sub">{t.sub}</p>

        <form className="home-input" onSubmit={submit}>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t.inputPlaceholder}
            aria-label={t.inputPlaceholder}
            dir="auto"
          />
          <button type="submit" className="home-send" aria-label={t.send}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>

        <div className="entries">
          {t.entries.map((entry) => (
            <button key={entry.id} type="button" className="entry-card" onClick={() => onStart(entry.prompt)}>
              <span className="entry-icon" aria-hidden="true">
                {entry.id === 'coding' ? <CodeIcon /> : entry.id === 'learning' ? <LearnIcon /> : entry.id === 'writing' ? <WriteIcon /> : <ExploreIcon />}
              </span>
              <strong>{entry.title}</strong>
              <span>{entry.desc}</span>
            </button>
          ))}
        </div>
      </main>

      <footer className="home-footer">
        {t.footerNote}
        <span className="sep">·</span>
        {t.version}
      </footer>
    </div>
  )
}

function CodeIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LearnIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path
        d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14zM4 19.5A2.5 2.5 0 006.5 22H20v-5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function WriteIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 20h9" strokeLinecap="round" />
      <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExploreIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" strokeLinejoin="round" />
    </svg>
  )
}
