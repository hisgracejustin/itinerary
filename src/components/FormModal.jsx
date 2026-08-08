"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function FormModal({
  title,
  onClose,
  children,
  footer,
  maxWidth = "max-w-lg",
}) {
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (!overlay || !dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const background = [...document.body.children]
      .filter((element) => element !== overlay)
      .map((element) => ({ element, inert: element.inert, ariaHidden: element.getAttribute("aria-hidden") }));
    for (const { element } of background) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    document.body.style.overflow = "hidden";

    const frame = requestAnimationFrame(() => {
      const preferred = dialog.querySelector("[autofocus]") || dialog.querySelector(FOCUSABLE);
      (preferred || dialog).focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      for (const { element, inert, ariaHidden } of background) {
        element.inert = inert;
        if (ariaHidden == null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose]);

  const handleKeyDown = (event) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (event.key === "Escape") {
      // Let an open picker consume Escape before the parent dialog closes.
      if (dialog.querySelector('[role="listbox"]')) return;
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll(FOCUSABLE)]
      .filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-start justify-center pt-4 sm:pt-[8vh] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] animate-fade-in">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`relative bg-white rounded-2xl shadow-elevation-4 w-full ${maxWidth} max-h-full flex flex-col animate-scale-in overflow-hidden`}
      >
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-outline/20 shrink-0">
          <h2 className="text-xl font-medium text-on-surface truncate">{title}</h2>
          <button type="button" onClick={onClose} className="mat-icon-btn" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 min-h-0 px-6 py-5 overflow-y-auto overflow-x-hidden">{children}</div>
        {footer && (
          <div className="border-t border-outline/20 px-6 py-4 shrink-0">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
