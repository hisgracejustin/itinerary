"use client";

import { useEffect, useState } from 'react'
import {
  DEFAULT_TEXT_SIZE,
  TEXT_SIZES,
  TEXT_SIZE_LABELS,
  applyTextSize,
  readTextSize,
} from '../lib/text-size'

/**
 * Settings → Text size: A− / A+ step through TEXT_SIZES and the whole app
 * resizes at once, which is its own preview. Saved per device (src/lib/text-size).
 */
export default function TextSizeSetting() {
  const [size, setSize] = useState(DEFAULT_TEXT_SIZE)
  // The saved size lives in this browser, so it's only known after mounting.
  useEffect(() => {
    setSize(readTextSize())
  }, [])
  const index = TEXT_SIZES.indexOf(size)
  const step = (by) => {
    const next = TEXT_SIZES[index + by]
    if (next == null) return
    applyTextSize(next)
    setSize(next)
  }

  return (
    <section className="mb-8" data-testid="text-size-setting">
      <h3 className="text-sm font-semibold text-on-surface mb-3">Text size</h3>
      <div className="mat-surface p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm text-on-surface">Make text and buttons bigger</p>
          <p className="text-xs text-on-surface-variant mt-0.5">Saved on this device only</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={index <= 0}
            aria-label="Smaller text"
            className="mat-btn-outlined h-11 min-w-[3.25rem] px-3 justify-center disabled:opacity-40"
          >
            <span className="text-sm" aria-hidden>A−</span>
          </button>
          <span className="w-20 text-center text-sm font-medium text-on-surface" aria-live="polite">
            {TEXT_SIZE_LABELS[size]}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={index >= TEXT_SIZES.length - 1}
            aria-label="Larger text"
            className="mat-btn-outlined h-11 min-w-[3.25rem] px-3 justify-center disabled:opacity-40"
          >
            <span className="text-lg" aria-hidden>A+</span>
          </button>
        </div>
      </div>
    </section>
  )
}
