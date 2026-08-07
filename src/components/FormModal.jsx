"use client";

import { useEffect } from "react";

export default function FormModal({
  title,
  onClose,
  children,
  footer,
  maxWidth = "max-w-lg",
}) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-4 sm:pt-[8vh] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] animate-fade-in">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
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
    </div>
  );
}
