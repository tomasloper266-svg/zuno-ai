import type { ReactNode } from 'react'
import { CodeBlock } from '../chat/CodeBlock'

/**
 * Minimal, dependency-free renderer for the subset of markdown ZUNO needs:
 * fenced code blocks, paragraphs, **bold**, `inline code`, and quotes.
 * Author-controlled demo replies and API replies keep to this subset.
 */

const FENCE = /```([A-Za-z0-9_+-]*)\n([\s\S]*?)```/g

export function renderMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let key = 0
  let last = 0
  FENCE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = FENCE.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(<Prose key={key++} text={text.slice(last, match.index)} />)
    }
    parts.push(<CodeBlock key={key++} language={match[1] ?? ''} code={match[2].replace(/\n$/, '')} />)
    last = match.index + match[0].length
  }
  if (last < text.length) {
    parts.push(<Prose key={key++} text={text.slice(last)} />)
  }
  return parts
}

function Prose({ text }: { text: string }): ReactNode {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter((block) => block.length > 0)
        .map((block, i) =>
          block.startsWith('> ') || block === '>' ? (
            <blockquote key={i}>
              {block
                .split('\n')
                .map((line) => line.replace(/^>\s?/, ''))
                .map((line, j) => (
                  <span key={j} style={{ display: 'block' }}>
                    {inline(line, `${i}-${j}`)}
                  </span>
                ))}
            </blockquote>
          ) : (
            <p key={i}>{linesWithBreaks(block, String(i))}</p>
          ),
        )}
    </>
  )
}

function linesWithBreaks(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={`${keyPrefix}-br-${i}`} />)
    out.push(...inline(line, `${keyPrefix}-${i}`))
  })
  return out
}

const INLINE = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let key = 0
  let last = 0
  let match: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index))
    if (match[1] !== undefined) {
      out.push(<strong key={`${keyPrefix}-${key++}`}>{match[1]}</strong>)
    } else {
      out.push(
        <code key={`${keyPrefix}-${key++}`} className="inline">
          {match[2]}
        </code>,
      )
    }
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
