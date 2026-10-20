import { useEffect, useRef } from 'react'
import type { Strings } from '../i18n/strings'

interface ConfirmDeleteDialogProps {
  t: Strings
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Small confirmation dialog for deleting a conversation — a destructive tap
 * must never be a one-click action. Focus moves into the dialog on open (the
 * safe Cancel button, so a stray Enter can never delete), Escape and outside
 * pointerdown cancel (the same contract as the actions menu), and the opener
 * refocuses on close (the caller keeps the trigger). Copy direction follows
 * the text via dir="auto", so Arabic and English render correctly in both
 * themes; colors come from the shared design tokens.
 */
export function ConfirmDeleteDialog({ t, onConfirm, onCancel }: ConfirmDeleteDialogProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancel()
    }
    function onPointerDown(e: PointerEvent): void {
      if (cardRef.current !== null && !cardRef.current.contains(e.target as Node)) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    cancelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onCancel])

  return (
    <div className="dialog-overlay">
      <div className="dialog-card" ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="zuno-delete-dialog-title">
        <h2 id="zuno-delete-dialog-title">{t.chat.deleteConfirmTitle}</h2>
        <p dir="auto">{t.chat.deleteConfirmBody}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            {t.chat.cancel}
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            {t.chat.deleteConfirmAction}
          </button>
        </div>
      </div>
    </div>
  )
}
