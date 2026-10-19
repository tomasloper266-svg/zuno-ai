import { useMemo, useState } from 'react'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import { copyText } from '../lib/util'

// Register a lean set of common languages (keeps the bundle small).
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('jsx', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function normalizeLanguage(raw: string): string {
  const lang = raw.trim().toLowerCase()
  return hljs.getLanguage(lang) !== undefined ? lang : ''
}

interface CodeBlockProps {
  code: string
  language: string
}

export function CodeBlock({ code, language }: CodeBlockProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const lang = normalizeLanguage(language)

  const html = useMemo(() => {
    try {
      return lang !== '' ? hljs.highlight(code, { language: lang }).value : escapeHtml(code)
    } catch {
      return escapeHtml(code)
    }
  }, [code, lang])

  async function handleCopy(): Promise<void> {
    const ok = await copyText(code)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div className="code-block" dir="ltr">
      <div className="code-block-header">
        <span className="code-lang">{lang !== '' ? lang : language !== '' ? language : 'text'}</span>
        <button type="button" className={`code-copy${copied ? ' copied' : ''}`} onClick={() => void handleCopy()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            {copied ? (
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
            ) : (
              <>
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 012-2h10" strokeLinecap="round" />
              </>
            )}
          </svg>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
}
