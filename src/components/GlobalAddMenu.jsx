"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const ACTIONS = [
  { kind: "booking", icon: "✈️", title: "Booking", detail: "Flight, stay, activity, or transport" },
  { kind: "todo", icon: "☑️", title: "To-do", detail: "Add something that needs doing" },
  { kind: "expense", icon: "🧾", title: "Expense", detail: "Record and split a shared cost" },
  { kind: "payment", icon: "💸", title: "Payment", detail: "Record money paid between people" },
];

export default function GlobalAddMenu({ onSelect, onClose, disabled = false }) {
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
    const frame = requestAnimationFrame(() => dialog.querySelector("button:not([disabled])")?.focus());
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
  }, []);

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = [...(dialogRef.current?.querySelectorAll("button:not([disabled])") || [])];
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
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
    <div ref={overlayRef} className="fixed inset-0 z-40">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add something"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="absolute inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-14 w-auto sm:w-80 rounded-2xl bg-white border border-outline/20 shadow-elevation-4 p-2 animate-scale-in"
      >
        <div className="flex items-center justify-between px-3 py-2">
          <h2 className="text-sm font-semibold text-on-surface">Add something</h2>
          <button type="button" onClick={onClose} className="mat-icon-btn" aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {disabled && (
          <p className="mx-3 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No editable trips are selected.
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-1 gap-1">
          {ACTIONS.map((action) => (
            <button
              key={action.kind}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(action.kind)}
              className="flex items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-xl shrink-0" aria-hidden>{action.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-on-surface">{action.title}</span>
                <span className="block text-[11px] leading-snug text-on-surface-variant mt-0.5">{action.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
