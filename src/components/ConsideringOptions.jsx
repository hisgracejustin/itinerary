"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TYPE_ICONS } from "@/lib/calendar";
import { formatCurrency } from "@/lib/currencies";
import { renderSoftMarkdown } from "@/lib/soft-markdown";

// Shared image-or-emoji fill for both the List thumb and the Details thumb —
// the placeholder rules (never an empty/stretched box) are identical, only
// the wrapper size/radius differ per caller.
function ThumbFill({ image, type }) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/option-images/${image.id}`}
      alt=""
      loading="lazy"
      className="w-full h-full object-cover"
    />
  ) : (
    <span className="flex w-full h-full items-center justify-center text-lg opacity-60">
      {TYPE_ICONS[type]}
    </span>
  );
}

/** Dense 48px row for the List view — the whole row is one tap target, no nested buttons. */
export function OptionListRow({ option, type, isCheapest, delta, currency, onOpen }) {
  const pros = option.pros || [];
  const cons = option.cons || [];
  const flags = [];
  if (option.is_pick) flags.push("Picked");
  if (option.converted_booking_id) flags.push("Booked");
  if (pros.length) flags.push(`✓ ${pros.length}`);
  if (cons.length) flags.push(`✕ ${cons.length}`);
  const subtitle = flags.length
    ? flags.join(" · ")
    : String(option.notes || "").trim().split("\n")[0] || "";

  const hasCost = option.cost_amount != null && Number.isFinite(Number(option.cost_amount));

  return (
    <button
      type="button"
      onClick={() => onOpen(option.id)}
      className={`w-full text-left mat-surface !rounded-2xl px-3 py-2.5 flex items-center gap-3 active:scale-[0.99] transition-transform ${
        option.is_pick ? "ring-2 ring-primary" : ""
      }`}
    >
      <div className="w-12 h-12 rounded-[9px] overflow-hidden shrink-0 bg-surface-container">
        <ThumbFill image={option.images?.[0]} type={type} />
      </div>
      {/* min-w-0 is required here or `truncate` below does nothing inside a flex row */}
      <div className="flex-1 min-w-0">
        <div className="truncate text-[14.5px] font-semibold leading-tight">{option.title}</div>
        {subtitle ? (
          <div className="truncate text-xs text-on-surface-variant">{subtitle}</div>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        {hasCost ? (
          <div className="text-base font-semibold tabular-nums">
            {formatCurrency(option.cost_amount, option.cost_currency)}
          </div>
        ) : (
          <div className="text-xs text-on-surface-variant">No cost</div>
        )}
        <div className="text-[10px] tabular-nums">
          {isCheapest ? (
            <span className="text-emerald-700 font-semibold">cheapest</span>
          ) : currency && delta > 0 ? (
            <span className="text-on-surface-variant">+{delta.toLocaleString()}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/** Full re-flowed card for the Details view — mirrors OptionCard's logic, one column wide. */
export function MobileOptionCard({
  option,
  tripType,
  isCheapest,
  pending,
  notesOpen,
  onNotesToggle,
  onEdit,
  onDelete,
  onPick,
  onBook,
  onOpenPhotos,
  cardRef,
}) {
  const notesHtml = useMemo(() => renderSoftMarkdown(option.notes), [option.notes]);
  const pros = option.pros || [];
  const cons = option.cons || [];
  const hasImages = (option.images || []).length > 0;

  return (
    <article
      ref={cardRef}
      className={`mat-surface overflow-hidden relative scroll-mt-28 ${
        option.is_pick ? "ring-2 ring-primary shadow-md" : ""
      }`}
    >
      {option.is_pick && (
        <div className="absolute top-3 left-0 z-10 bg-primary text-white text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-r-full shadow-elevation-1">
          Picked
        </div>
      )}
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 p-3 items-start">
        {hasImages ? (
          <button
            type="button"
            onClick={onOpenPhotos}
            className="relative w-24 h-24 rounded-xl overflow-hidden bg-surface-container"
          >
            <ThumbFill image={option.images[0]} type={tripType} />
            <span className="absolute bottom-1 right-1 bg-black/55 text-white text-[10px] rounded-full px-1.5">
              {option.images.length}
            </span>
          </button>
        ) : (
          <div className="w-24 h-24 rounded-xl overflow-hidden bg-surface-container">
            <ThumbFill image={null} type={tripType} />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-on-surface leading-snug m-0">{option.title}</h3>
          {option.url ? (
            <a
              href={option.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary font-medium hover:underline"
            >
              View listing →
            </a>
          ) : null}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {option.cost_amount != null && option.cost_currency ? (
              <div className="text-xl font-semibold text-on-surface tabular-nums">
                {formatCurrency(option.cost_amount, option.cost_currency)}
              </div>
            ) : (
              <div className="text-sm text-on-surface-variant">No cost set</div>
            )}
            {isCheapest ? (
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">
                Cheapest
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="px-3 pb-3 flex flex-col gap-2.5">
        {/* One merged column, not the desktop 2-col grid — that's what wrapped every
            bullet at 280px. */}
        {pros.length || cons.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {pros.map((p, i) => (
              <li key={`pro-${i}`} className="grid grid-cols-[16px_minmax(0,1fr)] gap-1.5">
                <span className="text-emerald-700 font-bold" aria-hidden>✓</span>
                <span className="text-on-surface">{p}</span>
              </li>
            ))}
            {cons.map((c, i) => (
              <li key={`con-${i}`} className="grid grid-cols-[16px_minmax(0,1fr)] gap-1.5">
                <span className="text-red-700 font-bold" aria-hidden>✕</span>
                <span className="text-on-surface">{c}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {notesHtml ? (
          <details
            open={notesOpen}
            onToggle={(event) => onNotesToggle?.(event.currentTarget.open)}
            className="border-t border-outline-variant pt-2.5"
          >
            <summary className="text-xs font-semibold text-on-surface-variant cursor-pointer">Notes</summary>
            <div
              className="notes-md mt-2 text-xs text-on-surface-variant [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1 [&_p]:my-0.5 [&_li]:my-0.5"
              dangerouslySetInnerHTML={{ __html: notesHtml }}
            />
          </details>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending || !!option.converted_booking_id}
            className="mat-btn-filled flex-1 min-h-[44px] justify-center disabled:opacity-50 disabled:cursor-default"
            onClick={onBook}
          >
            {option.converted_booking_id ? "Booked" : "Book this"}
          </button>
          <button
            type="button"
            disabled={pending}
            className={
              option.is_pick
                ? "mat-btn-filled flex-1 min-h-[44px] justify-center disabled:opacity-50"
                : "mat-btn-outlined flex-1 min-h-[44px] justify-center disabled:opacity-50"
            }
            onClick={onPick}
          >
            {pending ? "Working…" : option.is_pick ? "Unpick" : "Pick"}
          </button>
          <OverflowMenu
            disabled={pending}
            items={[
              { label: "Edit", onSelect: onEdit },
              { label: "Delete", onSelect: onDelete, danger: true },
            ]}
          />
        </div>
      </div>
    </article>
  );
}

/** Minimal popover menu — there's no menu primitive in the codebase yet. */
export function OverflowMenu({ items, disabled }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-11 shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className="mat-btn-outlined w-11 !px-0 min-h-[44px] justify-center disabled:opacity-50"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 bottom-full mb-1 z-20 min-w-[160px] mat-surface py-1 shadow-elevation-2"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-surface-container ${
                item.danger ? "text-red-600" : ""
              }`}
              onClick={() => {
                setOpen(false);
                item.onSelect?.();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Full-screen photo viewer — mobile Details only shows the first photo otherwise. */
export function PhotoLightbox({ images, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex || 0);
  const total = images?.length || 0;

  useEffect(() => setIdx(startIndex || 0), [startIndex]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
      else if (event.key === "ArrowLeft") setIdx((i) => (i - 1 + total) % total);
      else if (event.key === "ArrowRight") setIdx((i) => (i + 1) % total);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [total, onClose]);

  if (!total) return null;
  const img = images[idx];

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <div className="flex justify-end p-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-11 h-11 rounded-full flex items-center justify-center text-white text-xl hover:bg-white/10"
        >
          ✕
        </button>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/option-images/${img.id}`} alt="" className="max-h-full max-w-full object-contain" />
        {total > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => setIdx((i) => (i - 1 + total) % total)}
              className="absolute inset-y-0 left-0 w-1/3 flex items-center justify-start pl-2"
            >
              <span className="w-11 h-11 rounded-full bg-white/10 text-white text-2xl flex items-center justify-center">‹</span>
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => setIdx((i) => (i + 1) % total)}
              className="absolute inset-y-0 right-0 w-1/3 flex items-center justify-end pr-2"
            >
              <span className="w-11 h-11 rounded-full bg-white/10 text-white text-2xl flex items-center justify-center">›</span>
            </button>
          </>
        ) : null}
      </div>
      <div className="flex flex-col items-center gap-2 pb-4">
        {total > 1 ? (
          <div className="flex gap-1.5">
            {images.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === idx ? "bg-white" : "bg-white/40"}`} />
            ))}
          </div>
        ) : null}
        <div className="text-white/70 text-xs tabular-nums">{idx + 1} / {total}</div>
      </div>
    </div>
  );
}
