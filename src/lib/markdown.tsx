import type { ReactNode } from 'react'
import { CodeBlock } from '../chat/CodeBlock'

/**
 * Minimal, dependency-free renderer for the subset of markdown ZUNO needs:
 * fenced code blocks, headings (h1–h4), nested lists (two levels), simple
 * GFM-style tables, links, paragraphs, **bold**, `inline code`, and quotes.
 * Assistant replies keep to this subset.
 *
 * Security posture: the output is STRUCTURED React nodes — never innerHTML.
 * All text (including anything that looks like HTML: `<script>`, `onerror`,
 * `<img src=x onerror=…>`) is escaped by React on its way into the DOM. Links
 * render as real anchors only for an http(s)/mailto allowlist; every other
 * scheme (`javascript:`, `data:`, protocol-relative, …) is defused to plain
 * text, and every anchor carries target="_blank" rel="noopener noreferrer".
 */

const FENCE_SOURCE = '```([A-Za-z0-9_+-]*)\\n([\\s\\S]*?)```'

export function renderMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let key = 0
  let last = 0
  // A fresh regex per call — module-level `g` regexes carry lastIndex across
  // calls and break under reentrancy.
  const fence = new RegExp(FENCE_SOURCE, 'g')
  let match: RegExpExecArray | null

  while ((match = fence.exec(text)) !== null) {
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

/* ------------------------------------------------------------------ */
/* Prose: blank-line-separated blocks parsed line by line into segments */
/* ------------------------------------------------------------------ */

type Segment =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; content: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'para'; lines: string[] }
  | { kind: 'list'; items: ListEntry[]; ordered: boolean }

function Prose({ text }: { text: string }): ReactNode {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter((block) => block.length > 0)
        .map((block, i) => (
          <Segmented key={i} lines={block.split('\n')} keyPrefix={String(i)} />
        ))}
    </>
  )
}

/** Parse one blank-line-separated block into segments and render them. */
function Segmented({ lines, keyPrefix }: { lines: string[]; keyPrefix: string }): ReactNode {
  return (
    <>
      {parseSegments(lines).map((segment, i) => (
        <SegmentView key={`${keyPrefix}-${i}`} segment={segment} keyPrefix={`${keyPrefix}-${i}`} />
      ))}
    </>
  )
}

const HEADING = /^(#{1,4})\s+(.+)$/
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/
const QUOTE = /^(\s*)>\s?(.*)$/

/** Group the block's lines into typed segments. A line is a heading when it
 * stands alone as `#… `; consecutive `- `/`1. ` lines form a list (two levels
 * max — deeper indentation folds into the second); a `|…|` line followed by a
 * `---|---` separator opens a table; consecutive `> ` lines are a quote; the
 * rest accumulates into a paragraph. Pure. */
function parseSegments(lines: string[]): Segment[] {
  const segments: Segment[] = []
  let paragraph: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      segments.push({ kind: 'para', lines: paragraph })
      paragraph = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const heading = HEADING.exec(line)
    if (heading !== null) {
      flushParagraph()
      segments.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3 | 4, content: heading[2] })
      continue
    }
    const quote = QUOTE.exec(line)
    if (quote !== null) {
      flushParagraph()
      const quoteLines: string[] = [quote[2]]
      while (i + 1 < lines.length) {
        const next = QUOTE.exec(lines[i + 1])
        if (next === null) break
        quoteLines.push(next[2])
        i++
      }
      segments.push({ kind: 'quote', lines: quoteLines })
      continue
    }
    if (LIST_ITEM.test(line)) {
      flushParagraph()
      const itemLines: string[] = []
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        itemLines.push(lines[i])
        i++
      }
      i--
      segments.push(parseList(itemLines))
      continue
    }
    // Table: this line has a pipe and the NEXT line is a ---|--- separator.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes('|')) {
      flushParagraph()
      const header = splitTableRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      i--
      segments.push({ kind: 'table', header, rows })
      continue
    }
    paragraph.push(line)
  }
  flushParagraph()
  return segments
}

/** Drop the outer pipes of a `| a | b |` row and trim each cell. */
function splitTableRow(row: string): string[] {
  const cells = row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells.map((cell) => cell.trim())
}

function SegmentView({ segment, keyPrefix }: { segment: Segment; keyPrefix: string }): ReactNode {
  switch (segment.kind) {
    case 'heading': {
      const Tag = `h${segment.level}` as 'h1'
      return <Tag>{inline(segment.content, keyPrefix)}</Tag>
    }
    case 'quote':
      return (
        <blockquote>
          {segment.lines.map((line, j) => (
            <span key={j} style={{ display: 'block' }}>
              {inline(line, `${keyPrefix}-${j}`)}
            </span>
          ))}
        </blockquote>
      )
    case 'table':
      return (
        <div className="md-table-wrap">
          <table>
            <thead>
              <tr>
                {segment.header.map((cell, c) => (
                  <th key={c}>{inline(cell, `${keyPrefix}-h-${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {segment.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{inline(cell, `${keyPrefix}-${r}-${c}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'list':
      return renderList(segment.items, segment.ordered, keyPrefix)
    case 'para':
      return <p>{linesWithBreaks(segment.lines.join('\n'), keyPrefix)}</p>
  }
}

/* -------------------------------------------------- */
/* Lists — two levels of nesting, ordered or unordered */
/* -------------------------------------------------- */

interface ListEntry {
  text: string
  /** Nested (indented) items under this entry — second and final level. */
  children: ListEntry[]
  childOrdered: boolean
}

/** Parse consecutive list-item lines into a two-level structure. The items'
 * own markers decide ordered vs unordered; an indented item nests under the
 * previous top-level entry (deeper indentation folds into the same level —
 * two levels are supported, as documented). Pure. */
function parseList(itemLines: string[]): { kind: 'list'; items: ListEntry[]; ordered: boolean } {
  const items: ListEntry[] = []
  let ordered = false
  for (const raw of itemLines) {
    const match = LIST_ITEM.exec(raw)
    if (match === null) continue
    const indent = match[1].replace(/\t/g, '  ').length
    const isOrderedItem = /^\d/.test(match[2])
    if (indent < 2) {
      if (items.length === 0) ordered = isOrderedItem
      items.push({ text: match[3], children: [], childOrdered: false })
    } else if (items.length > 0) {
      const parent = items[items.length - 1]
      if (parent.children.length === 0) parent.childOrdered = isOrderedItem
      parent.children.push({ text: match[3], children: [], childOrdered: false })
    }
  }
  return { kind: 'list', items, ordered }
}

function renderList(items: ListEntry[], ordered: boolean, keyPrefix: string): ReactNode {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag>
      {items.map((entry, i) => (
        <li key={`${keyPrefix}-${i}`}>
          {inline(entry.text, `${keyPrefix}-${i}`)}
          {entry.children.length > 0 &&
            renderList(entry.children, entry.childOrdered, `${keyPrefix}-${i}-n`)}
        </li>
      ))}
    </Tag>
  )
}

/* ------------------------------------------------------------------ */
/* Inline: links (scheme allowlist), bold, code — everything escaped    */
/* ------------------------------------------------------------------ */

function linesWithBreaks(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={`${keyPrefix}-br-${i}`} />)
    out.push(...inline(line, `${keyPrefix}-${i}`))
  })
  return out
}

const INLINE_SOURCE = '\\[([^\\]\\n]+)\\]\\(([^()\\n]+)\\)|\\*\\*([^*\\n]+)\\*\\*|`([^`\\n]+)`'

/** Only explicit http(s) and mailto URLs may become anchors — everything
 * else (`javascript:`, `data:`, `vbscript:`, protocol-relative `//…`,
 * relative paths, unknown schemes) is defused to plain text. Pure. */
export function isSafeLinkTarget(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url.trim())
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let key = 0
  let last = 0
  let match: RegExpExecArray | null
  // Fresh regex per call: inline() recurses on link text, and a shared
  // module-level `g` regex would clobber lastIndex across the recursion —
  // the outer loop would re-match the same link forever.
  const inlineRe = new RegExp(INLINE_SOURCE, 'g')
  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index))
    if (match[2] !== undefined) {
      // Link — real anchor only for allowlisted schemes; otherwise the whole
      // `[text](url)` form stays visible as plain text.
      const href = match[2]
      if (isSafeLinkTarget(href)) {
        out.push(
          <a key={`${keyPrefix}-${key++}`} href={href} target="_blank" rel="noopener noreferrer">
            {inline(match[1], `${keyPrefix}-${key}-t`)}
          </a>,
        )
      } else {
        out.push(match[0])
      }
    } else if (match[3] !== undefined) {
      out.push(<strong key={`${keyPrefix}-${key++}`}>{match[3]}</strong>)
    } else {
      out.push(
        <code key={`${keyPrefix}-${key++}`} className="inline">
          {match[4]}
        </code>,
      )
    }
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
