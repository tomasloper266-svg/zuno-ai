import { useState } from 'react'
import type { Message } from '../types'
import { renderMarkdown } from '../lib/markdown'
import { copyText } from '../lib/util'
import { ZunoLogo } from '../components/ZunoLogo'
import type { Strings } from '../i18n/strings'

interface MessageBubbleProps {
  message: Message
  t: Strings
  isLastAssistant: boolean
  onRegenerate: () => void
  /** Set for failed replies: re-runs this message in place (same stable id). */
  onRetry?: () => void
}

export function MessageBubble({ message, t, isLastAssistant, onRegenerate, onRetry }: MessageBubbleProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  // A reply the stop button or the stall watchdog cut short — always visually
  // distinct from a complete reply (badge + a calm edge), in both RTL and LTR.
  const isStopped = !isUser && message.stopped === true
  // A reply whose stream failed midway — the partial text was salvaged, and the
  // message carries its own retry instead of the global banner.
  const isFailed = !isUser && message.failed === true

  async function handleCopy(): Promise<void> {
    if (await copyText(message.content)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div className={`bubble-row ${message.role}`}>
      <span className={`avatar ${message.role}`} aria-hidden="true">
        {isUser ? t.chat.you.charAt(0) : <ZunoLogo size={20} />}
      </span>
      <div className="bubble-col">
        {/* is-latest marks the newest assistant reply — the CSS completion-pulse
            hook (zuno-complete). isLastAssistant is only true for assistant
            messages, so user bubbles never carry it. */}
        <div className={`bubble ${message.role}${isLastAssistant ? ' is-latest' : ''}${isStopped ? ' is-stopped' : ''}${isFailed ? ' is-failed' : ''}`} dir="auto">
          {isUser ? message.content : renderMarkdown(message.content)}
        </div>
        <div className="bubble-meta">
          {isStopped && <span className="stopped-tag">{t.chat.stopped}</span>}
          {isFailed && <span className="failed-tag">{t.chat.failed}</span>}
          {!isUser && message.demo === true && <span className="demo-tag" title={t.chat.demoNote}>DEMO</span>}
          {!isUser && (
            <button
              type="button"
              className="bubble-action"
              onClick={() => void handleCopy()}
              aria-label={t.chat.copy}
            >
              {copied ? t.chat.copied : t.chat.copy}
            </button>
          )}
          {!isUser && isLastAssistant && isFailed && onRetry && (
            <button type="button" className="bubble-action" onClick={onRetry}>
              {t.chat.retry}
            </button>
          )}
          {!isUser && isLastAssistant && !isFailed && (
            <button type="button" className="bubble-action" onClick={onRegenerate}>
              {t.chat.regenerate}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
