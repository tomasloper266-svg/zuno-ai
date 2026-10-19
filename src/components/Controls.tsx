import type { Lang } from '../i18n/strings'
import type { Strings } from '../i18n/strings'

interface ControlsProps {
  t: Strings
  lang: Lang
  theme: 'dark' | 'light'
  onToggleLang: () => void
  onToggleTheme: () => void
}

export function Controls({ t, lang, theme, onToggleLang, onToggleTheme }: ControlsProps): React.JSX.Element {
  return (
    <div className="controls">
      <button type="button" className="icon-btn" onClick={onToggleTheme} aria-label={t.nav.theme} title={t.nav.theme}>
        {theme === 'dark' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2" />
            <path
              d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path
              d="M20.5 14.2A8.5 8.5 0 019.8 3.5a8.5 8.5 0 1010.7 10.7z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="icon-btn lang-btn"
        onClick={onToggleLang}
        aria-label={t.nav.language}
        title={t.nav.language}
      >
        {lang === 'en' ? 'ع' : 'EN'}
      </button>
    </div>
  )
}
