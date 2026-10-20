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
}

export function MessageBubble({ message, t, isLastAssistant, onRegenerate }: MessageBubbleProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'

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
        <div className={`bubble ${message.role}${isLastAssistant ? ' is-latest' : ''}`} dir="auto">
          {isUser ? message.content : renderMarkdown(message.content)}
        </div>
        <div className="bubble-meta">
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
          {!isUser && isLastAssistant && (
            <button type="button" className="bubble-action" onClick={onRegenerate}>
              {t.chat.regenerate}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
