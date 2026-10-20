import { useEffect, useRef } from 'react'
import type { Strings } from '../i18n/strings'

interface ShortcutsDialogProps {
  t: Strings
  onClose: () => void
}

/**
 * Small bilingual shortcuts panel — how in-app keyboard shortcuts become
 * discoverable. One row per shortcut: what it does, and the key(s) that
 * trigger it. Opened by the ? key or from the sidebar kebab; focus moves to
 * the Close button on open, and Escape or an outside pointerdown closes it
 * (the caller re-focuses the opener — same contract as ConfirmDeleteDialog).
 * Copy direction follows the text via dir="auto".
 */
export function ShortcutsDialog({ t, onClose }: ShortcutsDialogProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    function onPointerDown(e: PointerEvent): void {
      if (cardRef.current !== null && !cardRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose])

  return (
    <div className="dialog-overlay">
      <div
        className="dialog-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="zuno-shortcuts-dialog-title"
      >
        <h2 id="zuno-shortcuts-dialog-title">{t.chat.shortcuts.title}</h2>
        <dl className="shortcuts-list">
          {t.chat.shortcuts.rows.map((row) => (
            <div className="shortcut-row" key={row.keys}>
              <dt dir="auto">{row.action}</dt>
              <dd>
                <kbd>{row.keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
        <div className="dialog-actions">
          <button ref={closeRef} type="button" onClick={onClose}>
            {t.chat.shortcuts.close}
          </button>
        </div>
      </div>
    </div>
  )
}
