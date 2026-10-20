// @vitest-environment jsdom
/** Regression suite for the upgraded, dependency-free markdown renderer
 * (wave DE): headings h1–h4, two-level nested lists, simple tables, links
 * locked to an http(s)/mailto allowlist, and full XSS defusal — the output
 * is structured nodes, never innerHTML, so model HTML comes out escaped. */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { renderMarkdown } from './markdown'

function mount(text: string): { container: HTMLElement; unmount: () => void } {
  const view = render(<div data-testid="md">{renderMarkdown(text)}</div>)
  return { container: view.container, unmount: view.unmount }
}

describe('headings (h1–h4)', () => {
  it('renders Arabic headings at every supported level', () => {
    const { container, unmount } = mount('# العنوان الرئيسي\n\n## قسم فرعي\n\n### تفصيل\n\n#### أخير')
    for (const [tag, text] of [
      ['h1', 'العنوان الرئيسي'],
      ['h2', 'قسم فرعي'],
      ['h3', 'تفصيل'],
      ['h4', 'أخير'],
    ] as const) {
      const el = container.querySelector(tag)
      expect(el).not.toBeNull()
      expect(el?.textContent).toBe(text)
    }
    unmount()
  })

  it('ignores five hashes (h5 is not part of the subset)', () => {
    const { container, unmount } = mount('##### too deep')
    expect(container.querySelector('h5')).toBeNull()
    unmount()
  })
})

describe('lists (ordered, unordered, two levels)', () => {
  it('renders an Arabic unordered list with nested items up to two levels', () => {
    const { container, unmount } = mount(
      '- عنصر أول\n- عنصر ثانٍ\n  - فرعي أ\n  - فرعي ب\n- عنصر ثالث',
    )
    const topUl = container.querySelector('ul')
    expect(topUl).not.toBeNull()
    const topItems = topUl?.querySelectorAll(':scope > li')
    expect(topItems).toHaveLength(3)
    const nested = topItems?.[1]?.querySelector(':scope > ul > li')
    expect(nested).not.toBeNull()
    expect(topUl?.querySelectorAll('li')).toHaveLength(5)
    unmount()
  })

  it('renders an ordered list with an unordered nested list', () => {
    const { container, unmount } = mount('1. أول\n2. ثانٍ\n  - ملاحظة\n3. ثالث')
    const ol = container.querySelector('ol')
    expect(ol).not.toBeNull()
    const nestedUl = ol?.querySelector('li ul')
    expect(nestedUl).not.toBeNull()
    expect(nestedUl?.textContent).toBe('ملاحظة')
    unmount()
  })
})

describe('tables (simple GFM subset)', () => {
  it('renders an Arabic table with header and body rows inside a scroll wrapper', () => {
    const { container, unmount } = mount(
      '| الأداة | الغرض |\n|---|---|\n| Vite | بناء |\n| Vitest | اختبار |',
    )
    const wrap = container.querySelector('.md-table-wrap')
    expect(wrap).not.toBeNull()
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('td')).toHaveLength(4)
    expect(container.querySelector('th')?.textContent).toBe('الأداة')
    unmount()
  })

  it('a block without a separator row is NOT a table', () => {
    const { container, unmount } = mount('| just text |\n| more text |')
    expect(container.querySelector('table')).toBeNull()
    unmount()
  })
})

describe('links — allowlist enforced', () => {
  it('an https link renders as an anchor with target=_blank and rel=noopener noreferrer', () => {
    const { container, unmount } = mount('اقرأ [الدليل](https://example.com/guide) للتفاصيل')
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(a?.getAttribute('href')).toBe('https://example.com/guide')
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a?.textContent).toBe('الدليل')
    unmount()
  })

  it('a mailto link renders as an anchor too', () => {
    const { container, unmount } = mount('[اتصل بنا](mailto:hi@example.com)')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('mailto:hi@example.com')
    unmount()
  })

  it('a javascript: URI is refused — no anchor, the raw form stays as plain text', () => {
    const { container, unmount } = mount('[اضغط هنا](javascript:alert(1))')
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('javascript:alert(1)')
    unmount()
  })

  it('data:, vbscript:, and protocol-relative URLs are refused as well', () => {
    for (const url of ['data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', '//evil.example.com/x']) {
      const { container, unmount } = mount(`[نص](${url})`)
      expect(container.querySelector('a')).toBeNull()
      unmount()
    }
  })
})

describe('XSS defusal — model HTML never reaches the DOM', () => {
  it('a <script> tag comes out as escaped text, no script element', () => {
    const { container, unmount } = mount('عادي <script>alert(1)</script> بعده')
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
    unmount()
  })

  it('an <img src=x onerror=…> never renders an img element', () => {
    const { container, unmount } = mount('<img src=x onerror="alert(1)">')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
    unmount()
  })

  it('an onerror attribute in flowing text is escaped, not parsed', () => {
    const { container, unmount } = mount('نص <div onerror="alert(1)">مضمن</div> أكثر')
    expect(container.querySelector('div[onerror]')).toBeNull()
    expect(container.textContent).toContain('onerror="alert(1)"')
    unmount()
  })

  it('raw HTML inside a markdown link text stays escaped and anchor-free', () => {
    const { container, unmount } = mount("['<img src=x onerror=alert(1)>'](https://example.com)")
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
    unmount()
  })
})

describe('existing behavior intact', () => {
  it('bold, inline code, and quotes still render', () => {
    const { container, unmount } = mount('**عريض** و`كود` وعلامة\n\n> اقتباس')
    expect(container.querySelector('strong')?.textContent).toBe('عريض')
    expect(container.querySelector('code')?.textContent).toBe('كود')
    expect(container.querySelector('blockquote')).not.toBeNull()
    unmount()
  })

  it('fenced code blocks with a language still render through CodeBlock', () => {
    const { container, unmount } = mount('```ts\nconst x: number = 1\n```\nبعده')
    const code = container.querySelector('pre code')
    expect(code).not.toBeNull()
    expect(container.textContent).toContain('const x: number = 1')
    unmount()
  })
})
