"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Styled danger confirmation overlay — the shared "are you sure?" for any
 * destructive action. Matches the booking-delete treatment (red trash icon,
 * Cancel / red confirm) so every delete reads the same.
 *
 * Prefer `useConfirmDanger` for imperative call sites (`const ok = await ask(...)`).
 */
export default function ConfirmDanger({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
}) {
  const overlayRef = useRef(null)
  const dialogRef = useRef(null)
  useEffect(() => {
    const overlay = overlayRef.current
    const dialog = dialogRef.current
    if (!overlay || !dialog) return
    const previousFocus = document.activeElement
    const background = [...document.body.children]
      .filter((element) => element !== overlay)
      .map((element) => ({ element, inert: element.inert, ariaHidden: element.getAttribute('aria-hidden') }))
    for (const { element } of background) {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }
    const frame = requestAnimationFrame(() => dialog.querySelector('button')?.focus())
    return () => {
      cancelAnimationFrame(frame)
      for (const { element, inert, ariaHidden } of background) {
        element.inert = inert
        if (ariaHidden == null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      }
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [])

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const buttons = [...(dialogRef.current?.querySelectorAll('button:not([disabled])') || [])]
    if (buttons.length === 0) return
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-danger-title"
      onClick={busy ? undefined : onCancel}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-2xl shadow-elevation-4 w-full max-w-sm p-6 animate-scale-in text-center"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </div>
        <h3 id="confirm-danger-title" className="text-lg font-medium text-on-surface mb-2">
          {title}
        </h3>
        {message && (
          <p className="text-sm text-on-surface-variant mb-8 leading-relaxed">
            {message}
          </p>
        )}
        {!message && <div className="mb-8" />}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="mat-btn-outlined disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium bg-red-600 text-white shadow-md hover:bg-red-700 active:scale-[0.97] transition-all duration-200 disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Imperative danger confirm. `ask({ title, message, confirmLabel })` resolves
 * to true/false. Render `dialog` once near the root of the calling component.
 */
export function useConfirmDanger() {
  const [pending, setPending] = useState(null)

  const ask = useCallback((opts) => {
    return new Promise((resolve) => {
      setPending({
        title: opts.title,
        message: opts.message ?? null,
        confirmLabel: opts.confirmLabel ?? 'Delete',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        resolve,
      })
    })
  }, [])

  const close = (result) => {
    pending?.resolve(result)
    setPending(null)
  }

  const dialog = pending ? (
    <ConfirmDanger
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null

  return { ask, dialog }
}
