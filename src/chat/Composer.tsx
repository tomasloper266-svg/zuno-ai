import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import type { Strings } from '../i18n/strings'
import { limitStatus, MAX_MESSAGE_CHARS, MAX_TOTAL_CHARS } from '../lib/limits'

interface ComposerProps {
  t: Strings
  value: string
  onChange: (value: string) => void
  onSend: (value: string) => void
  disabled: boolean
  /** True while a reply is streaming in: the send button becomes the stop button. */
  streaming: boolean
  onStop: () => void
  /** Characters the next request would carry besides the draft (the sent thread). */
  threadChars?: number
}

export function Composer({ t, value, onChange, onSend, disabled, streaming, onStop, threadChars = 0 }: ComposerProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Input-box enforcement of the Worker's wire limits: counting and feedback
  // here, never silent truncation — typing is never blocked, only sending.
  const status = limitStatus(value, threadChars)
  const over = status.messageOver || status.totalOver

  useEffect(() => {
    const el = textareaRef.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [value])

  function submit(): void {
    const clean = value.trim()
    if (clean === '' || disabled) return
    // Over-limit drafts are refused with the visible counter message — never
    // silently truncated and never sent.
    if (status.messageOver || status.totalOver) return
    onSend(clean)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends, Shift+Enter inserts a new line (ignoring IME composition).
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  // While a reply streams in, the send button's place is taken by an always-live
  // stop button — one control, no layout shift, direction-neutral icon.
  return (
    <div className="composer">
      <textarea
        ref={textareaRef}
        value={value}
        placeholder={t.chat.placeholder}
        aria-label={t.chat.placeholder}
        rows={1}
        dir="auto"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer-foot">
        {/* The counter replaces the hint while active — one compact line, no crowding. */}
        {(status.nearLimit || over) ? (
          <span
            className={`composer-counter${over ? ' is-over' : ''}`}
            role={over ? 'alert' : undefined}
            aria-live={over ? undefined : 'polite'}
          >
            {t.chat.limitCounter
              .replace('{message}', String(status.messageChars))
              .replace('{messageMax}', String(MAX_MESSAGE_CHARS))
              .replace('{total}', String(status.totalChars))
              .replace('{totalMax}', String(MAX_TOTAL_CHARS))}
            {over ? ` — ${t.chat.limitExceeded}` : ''}
          </span>
        ) : (
          <span className="composer-hint">{t.chat.hint}</span>
        )}
        <button
          type="button"
          className={`composer-send${streaming ? ' is-stop' : ''}`}
          onClick={streaming ? onStop : submit}
          disabled={!streaming && (disabled || value.trim() === '' || over)}
          aria-label={streaming ? t.chat.stopGenerating : t.send}
        >
          {streaming ? (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
