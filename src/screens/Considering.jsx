"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  createOptionSetAction,
  deleteOptionAction,
  deleteOptionSetAction,
  linkOptionBookingAction,
  markOptionPickAction,
  unpickOptionAction,
  updateOptionSetAction,
} from "@/actions/options";
import { friendlyError, unwrap } from "@/lib/friendlyError";
import { useTripContext } from "@/lib/trip-context";
import { TYPE_ICONS } from "@/lib/calendar";
import { CURRENCIES, formatCurrency } from "@/lib/currencies";
import { renderSoftMarkdown } from "@/lib/soft-markdown";
import { dedupeById, mergeConsideringSets } from "@/lib/considering-state";
import {
  OPTION_IMAGE_ACCEPT,
  OPTION_IMAGE_MAX_COUNT,
  OPTION_IMAGE_MAX_LABEL,
  isAllowedOptionImageType,
  OPTION_IMAGE_MAX_SIZE,
  OPTION_IMAGE_MAX_TOTAL_SIZE,
} from "@/lib/option-images";
import FilterChip from "@/components/FilterChip";
import BookingModal from "@/components/BookingModal";
import { useToast } from "@/components/Toast";
import { useConfirmDanger } from "@/components/ConfirmDanger";
import { createBooking, updateBooking, deleteBooking } from "@/lib/client-actions";

const TYPE_LABELS = {
  flight: "Flight",
  train: "Train",
  bus: "Bus",
  rental: "Rental",
  cruise: "Cruise",
  hotel: "Hotel",
  activity: "Activity",
};

const STATUS_LABELS = {
  open: "Open",
  decided: "Decided",
  dropped: "Dropped",
};

const STATUS_CLASS = {
  open: "bg-primary-light text-accent-ink",
  decided: "bg-emerald-50 text-emerald-700",
  dropped: "bg-surface-container text-on-surface-variant",
};

function formatDateRange(start, end) {
  if (!start && !end) return null;
  if (start && end && start !== end) return `${start} – ${end}`;
  return start || end;
}

function isValidWebUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function linesToList(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function listToLines(arr) {
  return (arr || []).join("\n");
}

async function readJsonOrThrow(res, fallback) {
  if (res.type === "opaqueredirect" || res.status === 0 || (res.status >= 300 && res.status < 400)) {
    throw new Error("Session expired — try signing in again");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `${fallback} (${res.status})`);
  return data;
}

async function fetchWithTimeout(url, init, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label} timed out — try again`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(url, init, timeoutMs, label, fallback) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await readJsonOrThrow(response, fallback);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label} timed out — try again`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function withDeadline(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} is taking too long. Check your connection and retry.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Persist option via JSON API — Server Actions hang forever behind Cloudflare. */
async function apiUpsertOption(setId, optionId, draftId, data) {
  if (optionId) {
    return fetchJsonWithTimeout(
      `/api/options/${optionId}`,
      {
        method: "PATCH",
        credentials: "same-origin",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
      20_000,
      "Option save",
      "Failed to update option",
    );
  }
  return fetchJsonWithTimeout(
    "/api/options",
    {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, id: draftId, option_set_id: setId }),
    },
    20_000,
    "Option save",
    "Failed to create option",
  );
}

async function uploadOptionImages(optionId, files, onUploaded, onProgress, onAllUploaded) {
  const failures = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const file = item.file;
    onProgress?.(`Uploading photo ${i + 1} of ${files.length}…`);
    const body = new FormData();
    body.append("option_id", optionId);
    body.append("image_id", item.id);
    body.append("file", file);
    let image;
    try {
      image = await fetchJsonWithTimeout(
        "/api/option-images",
        {
          method: "POST",
          body,
          credentials: "same-origin",
          redirect: "manual",
        },
        60_000,
        `Upload of ${file.name}`,
        `Failed to upload ${file.name}`,
      );
    } catch (error) {
      failures.push(`${file.name}: ${friendlyError(error)}`);
      continue;
    }
    // UI callbacks are deliberately outside the network error handler: a React
    // rendering problem must not misreport an already-committed upload as failed.
    onProgress?.(
      i + 1 === files.length ? "Finalizing…" : `Uploaded photo ${i + 1} of ${files.length}`,
    );
    onUploaded?.(item, image);
  }
  if (failures.length) {
    throw new Error(
      `${failures.length} photo${failures.length === 1 ? "" : "s"} failed. ${failures.join(" ")}`,
    );
  }
  onAllUploaded?.();
}

function ImageCarousel({ images }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [images]);
  if (!images?.length) {
    return (
      <div className="h-40 bg-surface-container flex items-center justify-center text-on-surface-variant text-sm">
        No photos
      </div>
    );
  }
  const img = images[idx];
  return (
    <div className="relative h-40 bg-surface-container overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/option-images/${img.id}`}
        alt=""
        className="w-full h-full object-cover"
      />
      {images.length > 1 && (
        <>
          <div className="absolute inset-0 flex items-center justify-between px-1.5 pointer-events-none">
            <button
              type="button"
              className="pointer-events-auto w-7 h-7 rounded-full bg-white/90 shadow-elevation-1 text-on-surface"
              onClick={() => setIdx((i) => (i - 1 + images.length) % images.length)}
              aria-label="Previous photo"
            >
              ‹
            </button>
            <button
              type="button"
              className="pointer-events-auto w-7 h-7 rounded-full bg-white/90 shadow-elevation-1 text-on-surface"
              onClick={() => setIdx((i) => (i + 1) % images.length)}
              aria-label="Next photo"
            >
              ›
            </button>
          </div>
          <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1">
            {images.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${i === idx ? "bg-white" : "bg-white/50"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ModalShell({ title, onClose, children, footer }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/45 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl shadow-elevation-3 w-full max-w-lg max-h-[90vh] overflow-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant sticky top-0 bg-white z-10">
          <h2 className="text-[17px] font-semibold text-on-surface">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-surface-container text-on-surface-variant"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3.5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-outline-variant sticky bottom-0 bg-white">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
      <span>
        {label}
        {hint ? <span className="font-normal opacity-70"> {hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function InlineError({ message, onDismiss, title = "Couldn’t save" }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="w-full rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-left text-xs text-red-800"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 shrink-0">⚠</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{title}</div>
          <div className="mt-0.5 break-words leading-relaxed">{message}</div>
        </div>
        {onDismiss ? (
          <button
            type="button"
            className="shrink-0 text-red-700 underline"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ProgressChip({ label, detail }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full rounded-xl border border-primary/30 bg-primary-light px-3 py-2.5 text-xs text-accent-ink"
    >
      <div className="flex items-center gap-2 font-semibold">
        <span
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
        />
        {label}
      </div>
      {detail ? <div className="mt-1 pl-5.5 leading-relaxed opacity-80">{detail}</div> : null}
    </div>
  );
}

const inputClass = "mat-input";

function DecisionForm({ trips, initial, defaultTripId, onClose, onSave }) {
  const [form, setForm] = useState({
    title: initial?.title || "",
    start_date: initial?.start_date || "",
    end_date: initial?.end_date || "",
    type: initial?.type || "hotel",
    trip_id: initial?.trip_id || defaultTripId || trips[0]?.id || "",
    status: initial?.status || "open",
    notes: initial?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const draftIdRef = useRef(initial?.id || crypto.randomUUID());
  const { toast } = useToast();

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.title.trim()) {
      setSaveError("Enter a title before saving.");
      return;
    }
    if (!form.trip_id) {
      setSaveError("Choose which trip this decision belongs to.");
      return;
    }
    if (busy) return;
    setBusy(true);
    setSaveError("");
    const payload = {
      ...form,
      ...(!initial ? { id: draftIdRef.current } : {}),
      title: form.title.trim(),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      notes: form.notes || null,
    };
    try {
      await withDeadline(onSave(payload), 20_000, "Decision save");
      onClose();
    } catch (e) {
      const message = friendlyError(e);
      setSaveError(message);
      toast(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={initial ? "Edit decision" : "New decision"}
      onClose={busy ? () => {} : onClose}
      footer={
        <div className="flex w-full flex-col gap-2">
          {busy ? (
            <ProgressChip
              label="Saving decision…"
              detail="Keep this window open. It will stop automatically if the connection stalls."
            />
          ) : null}
          <InlineError message={saveError} onDismiss={() => setSaveError("")} />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              className="mat-btn-outlined disabled:opacity-50"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              className="mat-btn-filled disabled:opacity-50"
              onClick={submit}
            >
              {busy ? "Saving…" : saveError ? "Retry save" : "Save"}
            </button>
          </div>
        </div>
      }
    >
      <Field label="Title">
        <input className={inputClass} value={form.title} onChange={(e) => set("title", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date">
          <input
            type="date"
            className={inputClass}
            value={form.start_date || ""}
            onChange={(e) => set("start_date", e.target.value)}
          />
        </Field>
        <Field label="End date">
          <input
            type="date"
            className={inputClass}
            value={form.end_date || ""}
            onChange={(e) => set("end_date", e.target.value)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <select className="mat-select w-full" value={form.type} onChange={(e) => set("type", e.target.value)}>
            {Object.entries(TYPE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {TYPE_ICONS[id]} {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trip">
          <select className="mat-select w-full" value={form.trip_id} onChange={(e) => set("trip_id", e.target.value)}>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Status">
        <select className="mat-select w-full" value={form.status} onChange={(e) => set("status", e.target.value)}>
          {Object.entries(STATUS_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Brief note" hint="(optional)">
        <textarea
          className={`${inputClass} min-h-[72px] resize-y`}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
    </ModalShell>
  );
}

function OptionForm({ setId, initial, onClose, onSave }) {
  const [form, setForm] = useState({
    title: initial?.title || "",
    url: initial?.url || "",
    cost_amount: initial?.cost_amount ?? "",
    cost_currency: initial?.cost_currency || "HKD",
    pros: listToLines(initial?.pros),
    cons: listToLines(initial?.cons),
    notes: initial?.notes || "",
    _removedImages: new Set(),
  });
  // Staged files + object-URL previews (revoked on remove / unmount).
  const [staged, setStaged] = useState([]); // { id, file, url }[]
  const [busy, setBusy] = useState(false);
  const [saveLabel, setSaveLabel] = useState("Save");
  const [saveError, setSaveError] = useState("");
  const savingRef = useRef(false);
  const draftIdRef = useRef(initial?.id || crypto.randomUUID());
  const stagedRef = useRef(staged);
  const fileRef = useRef(null);
  const { toast } = useToast();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const previewHtml = useMemo(() => renderSoftMarkdown(form.notes), [form.notes]);

  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  useEffect(() => {
    return () => {
      for (const s of stagedRef.current) URL.revokeObjectURL(s.url);
    };
  }, []);

  const onFiles = (fileList) => {
    setSaveError("");
    const next = [];
    for (const file of fileList || []) {
      if (!isAllowedOptionImageType(file.type)) {
        setSaveError(`“${file.name}” is not a supported PNG, JPEG, WebP, or GIF image.`);
        continue;
      }
      if (file.size > OPTION_IMAGE_MAX_SIZE) {
        setSaveError(`“${file.name}” is too large. Maximum ${OPTION_IMAGE_MAX_LABEL} per photo.`);
        continue;
      }
      next.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
    }
    const existingCount =
      (initial?.images || []).filter((img) => !form._removedImages?.has(img.id)).length +
      staged.length;
    const available = Math.max(0, OPTION_IMAGE_MAX_COUNT - existingCount);
    if (next.length > available) {
      for (const item of next.slice(available)) URL.revokeObjectURL(item.url);
      setSaveError(`Maximum ${OPTION_IMAGE_MAX_COUNT} photos per option.`);
    }
    const candidates = next.slice(0, available);
    const existingBytes =
      (initial?.images || [])
        .filter((img) => !form._removedImages?.has(img.id))
        .reduce((sum, img) => sum + Number(img.size_bytes || 0), 0) +
      staged.reduce((sum, item) => sum + item.file.size, 0);
    let totalBytes = existingBytes;
    const withinQuota = [];
    for (const item of candidates) {
      if (totalBytes + item.file.size > OPTION_IMAGE_MAX_TOTAL_SIZE) {
        URL.revokeObjectURL(item.url);
        setSaveError("This option has reached its 20MB photo storage limit.");
        continue;
      }
      totalBytes += item.file.size;
      withinQuota.push(item);
    }
    if (withinQuota.length) setStaged((s) => [...s, ...withinQuota]);
  };

  const removeStaged = (i) => {
    setStaged((s) => {
      const copy = [...s];
      const [gone] = copy.splice(i, 1);
      if (gone) URL.revokeObjectURL(gone.url);
      return copy;
    });
  };

  const submit = async () => {
    if (!form.title.trim()) {
      setSaveError("Enter a title before saving.");
      return;
    }
    if (form.url.trim() && !isValidWebUrl(form.url.trim())) {
      setSaveError("URL must start with http:// or https://");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    setSaveLabel("Saving option…");
    setSaveError("");

    const amount =
      form.cost_amount === "" || form.cost_amount == null
        ? null
        : Number(form.cost_amount);
    const payload = {
      title: form.title.trim(),
      url: form.url.trim() || null,
      cost_amount: Number.isFinite(amount) ? amount : null,
      cost_currency: form.cost_currency || null,
      pros: linesToList(form.pros),
      cons: linesToList(form.cons),
      notes: form.notes || null,
    };
    const files = staged.map((s) => ({ id: s.id, file: s.file }));
    const removed = form._removedImages || new Set();
    const optionId = initial?.id || null;
    const decisionId = setId;

    try {
      let completed = false;
      await onSave(
        decisionId,
        optionId,
        draftIdRef.current,
        payload,
        files,
        removed,
        (label) => setSaveLabel(label),
        (uploadedItem) => {
          setStaged((current) => {
            const uploaded = current.find((item) => item.id === uploadedItem.id);
            if (uploaded) URL.revokeObjectURL(uploaded.url);
            return current.filter((item) => item.id !== uploadedItem.id);
          });
        },
        () => {
          completed = true;
          onClose();
        },
      );
      if (!completed) onClose();
    } catch (e) {
      const message = friendlyError(e);
      setSaveError(message);
      toast(message);
      savingRef.current = false;
      setBusy(false);
      setSaveLabel("Retry save");
    }
  };

  return (
    <ModalShell
      title={initial ? "Edit option" : "Add option"}
      onClose={busy ? () => {} : onClose}
      footer={
        <div className="flex w-full flex-col gap-2">
          {busy ? (
            <ProgressChip
              label={saveLabel}
              detail="Photos upload one at a time. Successful photos stay saved if another one fails."
            />
          ) : null}
          <InlineError message={saveError} onDismiss={() => setSaveError("")} />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              className="mat-btn-outlined disabled:opacity-50"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              className="mat-btn-filled disabled:opacity-50"
              onClick={submit}
            >
              {busy ? "Working…" : saveError ? "Retry save" : "Save"}
            </button>
          </div>
        </div>
      }
    >
      <Field label="Title">
        <input className={inputClass} value={form.title} onChange={(e) => set("title", e.target.value)} />
      </Field>
      <Field label="URL" hint="(optional)">
        <input
          type="url"
          className={inputClass}
          value={form.url}
          onChange={(e) => set("url", e.target.value)}
          placeholder="https://…"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cost">
          <input
            type="number"
            className={inputClass}
            value={form.cost_amount}
            onChange={(e) => set("cost_amount", e.target.value)}
          />
        </Field>
        <Field label="Currency">
          <select
            className="mat-select w-full"
            value={form.cost_currency}
            onChange={(e) => set("cost_currency", e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Photos" hint={`(max ${OPTION_IMAGE_MAX_LABEL} each)`}>
        <div className="flex flex-wrap gap-2">
          {(initial?.images || [])
            .filter((img) => !form._removedImages?.has(img.id))
            .map((img) => (
              <div key={img.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/option-images/${img.id}`}
                  alt=""
                  className="w-16 h-16 rounded-[10px] object-cover bg-surface-container"
                />
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-on-surface text-white text-[10px] leading-none"
                  title="Remove photo"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      _removedImages: new Set([...(f._removedImages || []), img.id]),
                    }))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          {staged.map((s, i) => (
            <div key={s.url} className="relative w-16 h-16">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.url}
                alt={s.file.name}
                title={s.file.name}
                className="w-16 h-16 rounded-[10px] object-cover bg-surface-container"
              />
              <button
                type="button"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-on-surface text-white text-[10px]"
                onClick={() => removeStaged(i)}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="w-16 h-16 rounded-[10px] border border-dashed border-outline text-on-surface-variant text-2xl bg-surface-dim"
            onClick={() => fileRef.current?.click()}
          >
            +
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={OPTION_IMAGE_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pros" hint="(one per line)">
          <textarea
            className={`${inputClass} min-h-[80px] resize-y`}
            value={form.pros}
            onChange={(e) => set("pros", e.target.value)}
          />
        </Field>
        <Field label="Cons" hint="(one per line)">
          <textarea
            className={`${inputClass} min-h-[80px] resize-y`}
            value={form.cons}
            onChange={(e) => set("cons", e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes" hint="(**bold**, - bullets, 1. numbers)">
        <textarea
          className={`${inputClass} min-h-[80px] resize-y`}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
        {previewHtml ? (
          <div
            className="notes-md mt-1 font-normal text-xs text-on-surface-variant bg-surface-dim border border-outline-variant rounded-[10px] px-3 py-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1 [&_p]:my-0.5 [&_li]:my-0.5"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : null}
      </Field>
    </ModalShell>
  );
}

function OptionCard({ option, onEdit, onDelete, onPick, onBook, pending }) {
  const notesHtml = useMemo(() => renderSoftMarkdown(option.notes), [option.notes]);
  return (
    <article
      className={`mat-surface overflow-hidden flex flex-col relative h-full ${
        option.is_pick ? "ring-2 ring-primary shadow-md" : ""
      }`}
    >
      {option.is_pick && (
        <div className="absolute top-3 left-0 z-10 bg-primary text-white text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-r-full shadow-elevation-1">
          Picked
        </div>
      )}
      <ImageCarousel images={option.images} />
      <div className="p-4 flex flex-col gap-2.5 flex-1">
        <div>
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
        </div>
        {option.cost_amount != null && option.cost_currency ? (
          <div className="text-lg font-semibold text-on-surface">
            {formatCurrency(option.cost_amount, option.cost_currency)}
          </div>
        ) : (
          <div className="text-sm text-on-surface-variant">No cost set</div>
        )}
        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <div>
            <h4 className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">Pros</h4>
            {(option.pros || []).length ? (
              <ul className="m-0 pl-4 text-emerald-800 space-y-0.5 list-disc">
                {option.pros.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-on-surface-variant">—</p>
            )}
          </div>
          <div>
            <h4 className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wide text-red-700">Cons</h4>
            {(option.cons || []).length ? (
              <ul className="m-0 pl-4 text-red-800 space-y-0.5 list-disc">
                {option.cons.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-on-surface-variant">—</p>
            )}
          </div>
        </div>
        {notesHtml ? (
          <details className="border-t border-outline-variant pt-2.5">
            <summary className="text-xs font-semibold text-on-surface-variant cursor-pointer">Notes</summary>
            <div
              className="notes-md mt-2 text-xs text-on-surface-variant [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1 [&_p]:my-0.5 [&_li]:my-0.5"
              dangerouslySetInnerHTML={{ __html: notesHtml }}
            />
          </details>
        ) : null}
        <div className="flex flex-wrap gap-1.5 mt-auto pt-2">
          <button
            type="button"
            disabled={pending}
            className="mat-btn-outlined !text-xs !px-3 !py-1 disabled:opacity-50"
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            type="button"
            disabled={pending}
            className={
              option.is_pick
                ? "mat-btn-filled !text-xs !px-3 !py-1 disabled:opacity-50"
                : "mat-btn-outlined !text-xs !px-3 !py-1 disabled:opacity-50"
            }
            onClick={onPick}
          >
            {pending ? "Working…" : option.is_pick ? "Unpick" : "Mark as pick"}
          </button>
          <button
            type="button"
            disabled={pending || !!option.converted_booking_id}
            className="mat-btn-filled !text-xs !px-3 !py-1 disabled:opacity-50 disabled:cursor-default"
            onClick={onBook}
          >
            {option.converted_booking_id ? "Booked" : "Book this"}
          </button>
          <button
            type="button"
            disabled={pending}
            className="mat-icon-btn disabled:opacity-50"
            title="Delete"
            onClick={onDelete}
          >
            🗑
          </button>
        </div>
      </div>
    </article>
  );
}

export default function Considering({ initialSets }) {
  const { trips, selectedTrips, selectedTrip } = useTripContext();
  const { toast } = useToast();
  const { ask, dialog: confirmDialog } = useConfirmDanger();
  const [sets, setSets] = useState(initialSets);
  const [tripFilter, setTripFilter] = useState("all");
  const [activeId, setActiveId] = useState(null);
  const [decisionModal, setDecisionModal] = useState(null); // null | 'new' | set
  const [optionModal, setOptionModal] = useState(null); // null | { setId, option? }
  const [bookingDraft, setBookingDraft] = useState(null);
  const [linkingOptionId, setLinkingOptionId] = useState(null);
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const pendingOptionIdsRef = useRef(new Set());
  const pendingActionRef = useRef("");

  useEffect(() => {
    setSets((prev) =>
      mergeConsideringSets(prev, initialSets, pendingOptionIdsRef.current),
    );
  }, [initialSets]);

  const selSet = new Set(selectedTrips);
  const scoped = selectedTrips.length
    ? sets.filter((s) => selSet.has(s.trip_id))
    : sets;

  const showTripChips = selectedTrips.length === 0 && trips.length > 1;
  const filtered =
    tripFilter === "all" ? scoped : scoped.filter((s) => s.trip_id === tripFilter);

  const active = filtered.find((s) => s.id === activeId) || sets.find((s) => s.id === activeId);
  const tripName = (id) => trips.find((t) => t.id === id)?.name || "Trip";

  const refreshLocalSet = (id, patch) => {
    setSets((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const runVisibleAction = async (key, label, operation) => {
    if (pendingActionRef.current) return false;
    pendingActionRef.current = key;
    setPendingAction(key);
    setActionError("");
    try {
      await withDeadline(operation(), 20_000, label);
      return true;
    } catch (error) {
      const message = friendlyError(error);
      setActionError(message);
      toast(message);
      return false;
    } finally {
      pendingActionRef.current = "";
      setPendingAction("");
    }
  };

  const saveDecision = async (data) => {
    if (decisionModal && decisionModal !== "new" && decisionModal.id) {
      const row = unwrap(await updateOptionSetAction(decisionModal.id, data));
      refreshLocalSet(decisionModal.id, row);
      toast("Decision updated");
    } else {
      const row = unwrap(await createOptionSetAction(data));
      setSets((prev) => [{ ...row, options: [] }, ...prev]);
      toast("Decision created");
      setActiveId(row.id);
    }
  };

  const deleteDecision = async (set) => {
    const ok = await ask({
      title: "Delete this decision?",
      message: `“${set.title}” and all its options will be removed. This can’t be undone.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const succeeded = await runVisibleAction(
      `delete-set:${set.id}`,
      "Decision deletion",
      async () => unwrap(await deleteOptionSetAction(set.id)),
    );
    if (!succeeded) return;
    setSets((prev) => prev.filter((s) => s.id !== set.id));
    if (activeId === set.id) setActiveId(null);
    toast("Decision deleted");
  };

  const saveOption = async (
    setId,
    optionId,
    draftId,
    data,
    stagedFiles,
    removedImages,
    onProgress,
    onUploaded,
    onComplete,
  ) => {
    if (!setId) throw new Error("Missing decision");
    const pendingId = optionId || draftId;
    pendingOptionIdsRef.current.add(pendingId);
    let completionSent = false;
    const complete = () => {
      if (completionSent) return;
      completionSent = true;
      onComplete?.();
    };

    const mergeOption = (options, next, images = []) => {
      const idx = options.findIndex((o) => o.id === next.id);
      if (idx === -1) return [...options, { ...next, images }];
      const copy = options.slice();
      const prevImgs = copy[idx].images || [];
      copy[idx] = {
        ...copy[idx],
        ...next,
        images: images.length ? dedupeById([...prevImgs, ...images]) : prevImgs,
      };
      return copy;
    };

    const attachImage = (id, image) => {
      setSets((prev) =>
        prev.map((s) =>
          s.id !== setId
            ? s
            : {
                ...s,
                options: s.options.map((o) =>
                  o.id === id
                    ? { ...o, images: dedupeById([...(o.images || []), image]) }
                    : o,
                ),
              },
        ),
      );
    };

    try {
      onProgress?.("Saving option…");
      const row = await apiUpsertOption(setId, optionId, draftId, data);
      const id = row.id;

      setSets((prev) =>
        prev.map((s) => {
          if (s.id !== setId) return s;
          if (optionId) {
            return {
              ...s,
              options: s.options.map((o) =>
                o.id === optionId
                  ? { ...o, ...row, images: o.images || [] }
                  : o,
              ),
            };
          }
          return {
            ...s,
            options: dedupeById(mergeOption(s.options, { ...row, images: [] }, [])),
          };
        }),
      );

      if (stagedFiles?.length) {
        await uploadOptionImages(
          id,
          stagedFiles,
          (item, image) => {
            attachImage(id, image);
            onUploaded?.(item);
          },
          onProgress,
          removedImages?.size ? undefined : complete,
        );
      }

      const removed = removedImages || new Set();
      let deleted = 0;
      for (const imageId of removed) {
        deleted++;
        onProgress?.(`Removing photo ${deleted} of ${removed.size}…`);
        const res = await fetchWithTimeout(
          `/api/option-images/${imageId}`,
          {
            method: "DELETE",
            credentials: "same-origin",
            redirect: "manual",
          },
          20_000,
          "Photo removal",
        );
        if (res.status !== 404) await readJsonOrThrow(res, "Failed to remove photo");
        setSets((prev) =>
          prev.map((s) =>
            s.id !== setId
              ? s
              : {
                  ...s,
                  options: s.options.map((o) =>
                    o.id === id
                      ? { ...o, images: (o.images || []).filter((img) => img.id !== imageId) }
                      : o,
                  ),
                },
          ),
        );
      }
      onProgress?.("Saved");
      // Close from an explicit success signal. This is independent of React's
      // handling of the outer async callback/promise.
      complete();
      toast(optionId ? "Option updated" : "Option added");
    } finally {
      pendingOptionIdsRef.current.delete(pendingId);
    }
  };

  const deleteOption = async (setId, option) => {
    const ok = await ask({
      title: "Delete this option?",
      message: `“${option.title}” will be removed.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const succeeded = await runVisibleAction(
      `delete-option:${option.id}`,
      "Option deletion",
      async () => unwrap(await deleteOptionAction(option.id)),
    );
    if (!succeeded) return;
    setSets((prev) =>
      prev.map((s) =>
        s.id !== setId ? s : { ...s, options: s.options.filter((o) => o.id !== option.id) },
      ),
    );
    toast("Option deleted");
  };

  const markPick = async (setId, option) => {
    if (option.is_pick) {
      const succeeded = await runVisibleAction(
        `pick:${option.id}`,
        "Clearing pick",
        async () => unwrap(await unpickOptionAction(option.id)),
      );
      if (succeeded) {
        setSets((prev) =>
          prev.map((s) =>
            s.id !== setId
              ? s
              : {
                  ...s,
                  status: s.status === "decided" ? "open" : s.status,
                  options: s.options.map((o) =>
                    o.id === option.id ? { ...o, is_pick: false } : o,
                  ),
                },
          ),
        );
        toast("Pick cleared");
      }
      return;
    }
    const succeeded = await runVisibleAction(
      `pick:${option.id}`,
      "Selecting option",
      async () => unwrap(await markOptionPickAction(option.id)),
    );
    if (succeeded) {
      setSets((prev) =>
        prev.map((s) =>
          s.id !== setId
            ? s
            : {
                ...s,
                status: "decided",
                options: s.options.map((o) => ({
                  ...o,
                  is_pick: o.id === option.id,
                })),
              },
        ),
      );
      toast("Marked as pick");
    }
  };

  const openBook = (set, option) => {
    if (option.converted_booking_id) return;
    setLinkingOptionId(option.id);
    // Date-only → midday local-naive stamp so toLocalDatetime doesn't shift the
    // calendar day across negative UTC offsets.
    const wall = (d, hhmm) => (d ? `${d}T${hhmm}` : "");
    setBookingDraft({
      type: set.type,
      title: option.title,
      start_date: wall(set.start_date, "15:00"),
      end_date: wall(set.end_date, set.type === "hotel" ? "11:00" : "15:00"),
      trip_id: set.trip_id,
      cost_amount: option.cost_amount,
      cost_currency: option.cost_currency,
      provider: null,
      details: {
        notes: [
          option.url ? `Listing: ${option.url}` : null,
          ...(option.pros || []).map((p) => `+ ${p}`),
          ...(option.cons || []).map((c) => `− ${c}`),
          option.notes || null,
        ]
          .filter(Boolean)
          .join("\n"),
        map_url: option.url || undefined,
      },
    });
  };

  const handleBookingSave = async (data, existingId) => {
    const saved = existingId
      ? await updateBooking(existingId, data)
      : await createBooking(data);
    if (linkingOptionId && saved?.id) {
      try {
        unwrap(await linkOptionBookingAction(linkingOptionId, saved.id));
        setSets((prev) =>
          prev.map((s) => {
            const hit = s.options.some((o) => o.id === linkingOptionId);
            if (!hit) return s;
            return {
              ...s,
              status: "decided",
              options: s.options.map((o) =>
                o.id === linkingOptionId
                  ? { ...o, converted_booking_id: saved.id, is_pick: true }
                  : { ...o, is_pick: false },
              ),
            };
          }),
        );
      } catch (e) {
        const message = `Booking was created, but it could not be linked to this option. ${friendlyError(e)}`;
        setActionError(message);
        toast(message);
      }
    }
    setBookingDraft(null);
    setLinkingOptionId(null);
    return saved;
  };

  // List view
  if (!active) {
    return (
      <div className="w-full max-w-5xl lg:max-w-6xl mx-auto">
        {confirmDialog}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-on-surface m-0">Considering</h1>
            <p className="text-[13px] text-on-surface-variant mt-1 mb-0">
              Options you’re weighing — not on the calendar until you book.
            </p>
          </div>
          <button
            type="button"
            disabled={!trips.length || !!pendingAction}
            className="mat-btn-filled disabled:opacity-40 shrink-0"
            onClick={() => setDecisionModal("new")}
          >
            + New decision
          </button>
        </div>

        {pendingAction ? <ProgressChip label="Updating Considering…" detail="This will stop automatically if the connection stalls." /> : null}
        <InlineError
          title="Action failed"
          message={actionError}
          onDismiss={() => setActionError("")}
        />

        {showTripChips && (
          <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
            <FilterChip
              active={tripFilter === "all"}
              onClick={() => setTripFilter("all")}
              label="All trips"
            />
            {trips.map((trip) => {
              const count = scoped.filter((s) => s.trip_id === trip.id).length;
              return (
                <FilterChip
                  key={trip.id}
                  active={tripFilter === trip.id}
                  onClick={() => setTripFilter(tripFilter === trip.id ? "all" : trip.id)}
                  label={trip.name}
                  count={count}
                />
              );
            })}
          </div>
        )}

        {trips.length === 0 ? (
          <div className="mat-surface p-5 mt-4 text-center">
            <p className="text-sm text-on-surface mb-1">No trips yet</p>
            <p className="text-xs text-on-surface-variant mb-3">
              Decisions belong to a trip — create one in Settings first.
            </p>
            <Link href="/settings" className="mat-btn-filled inline-flex">
              Go to Settings
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4 text-2xl">
              🔎
            </div>
            <p className="text-sm font-medium">Nothing cooking yet — add a decision you’re weighing</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pb-10">
            {filtered.map((set) => (
              <button
                key={set.id}
                type="button"
                onClick={() => setActiveId(set.id)}
                className="text-left mat-surface px-4 py-4 grid grid-cols-[1fr_auto] gap-3 items-center hover:shadow-md transition-shadow"
              >
                <div>
                  <h3 className="text-base font-semibold m-0 mb-1.5 text-on-surface">{set.title}</h3>
                  <div className="flex flex-wrap gap-2 items-center text-xs text-on-surface-variant">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-700">
                      {TYPE_ICONS[set.type]} {TYPE_LABELS[set.type] || set.type}
                    </span>
                    {formatDateRange(set.start_date, set.end_date) && (
                      <span>{formatDateRange(set.start_date, set.end_date)}</span>
                    )}
                    <span>·</span>
                    <span>{tripName(set.trip_id)}</span>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full font-semibold ${STATUS_CLASS[set.status]}`}
                    >
                      {STATUS_LABELS[set.status]}
                    </span>
                  </div>
                </div>
                <div className="text-right text-xs text-on-surface-variant">
                  <div className="text-xl font-semibold text-on-surface leading-tight">
                    {set.options?.length || 0}
                  </div>
                  options
                </div>
              </button>
            ))}
          </div>
        )}

        {decisionModal && (
          <DecisionForm
            trips={trips}
            defaultTripId={selectedTrip || undefined}
            initial={decisionModal === "new" ? null : decisionModal}
            onClose={() => setDecisionModal(null)}
            onSave={saveDecision}
          />
        )}
      </div>
    );
  }

  // Detail / comparison board
  return (
    <div className="w-full max-w-6xl mx-auto">
      {confirmDialog}
      {pendingAction ? <ProgressChip label="Updating Considering…" detail="This will stop automatically if the connection stalls." /> : null}
      <InlineError
        title="Action failed"
        message={actionError}
        onDismiss={() => setActionError("")}
      />
      <div className="sticky top-0 z-10 bg-surface-dim/95 backdrop-blur-sm pb-4 mb-5 border-b border-outline-variant -mt-1 pt-1">
        <div className="flex items-center gap-1.5 text-xs text-on-surface-variant mb-2.5">
          <button
            type="button"
            className="text-primary font-medium hover:underline"
            onClick={() => setActiveId(null)}
          >
            Considering
          </button>
          <span>/</span>
          <span>{active.title}</span>
        </div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold m-0 text-on-surface">{active.title}</h1>
            <div className="flex flex-wrap gap-2 items-center text-xs text-on-surface-variant mt-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-700">
                {TYPE_ICONS[active.type]} {TYPE_LABELS[active.type]}
              </span>
              {formatDateRange(active.start_date, active.end_date) && (
                <span>{formatDateRange(active.start_date, active.end_date)}</span>
              )}
              <span>·</span>
              <span>{tripName(active.trip_id)}</span>
              <span className={`inline-flex px-2 py-0.5 rounded-full font-semibold ${STATUS_CLASS[active.status]}`}>
                {STATUS_LABELS[active.status]}
              </span>
            </div>
            {active.notes ? (
              <p className="text-xs text-on-surface-variant mt-2 mb-0 whitespace-pre-wrap">{active.notes}</p>
            ) : null}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={!!pendingAction}
              className="mat-btn-outlined !text-xs !px-3 !py-1.5 disabled:opacity-50"
              onClick={() => setDecisionModal(active)}
            >
              Edit
            </button>
            <button
              type="button"
              disabled={!!pendingAction}
              className="mat-btn-outlined !text-xs !px-3 !py-1.5 !border-red-300 !text-red-600 hover:!bg-red-50 disabled:opacity-50"
              onClick={() => deleteDecision(active)}
            >
              Delete
            </button>
            <button
              type="button"
              disabled={!!pendingAction}
              className="mat-btn-filled !text-xs !px-3 !py-1.5 disabled:opacity-50"
              onClick={() => setOptionModal({ setId: active.id })}
            >
              + Add option
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto snap-x pb-4 mb-8 sm:grid sm:grid-cols-2 xl:grid-cols-3 sm:overflow-visible sm:snap-none">
        {(active.options || []).map((option) => (
          <div key={option.id} className="w-[280px] shrink-0 snap-start sm:w-auto sm:shrink">
            <OptionCard
              option={option}
              onEdit={() => setOptionModal({ setId: active.id, option })}
              onDelete={() => deleteOption(active.id, option)}
              onPick={() => markPick(active.id, option)}
              onBook={() => openBook(active, option)}
              pending={!!pendingAction}
            />
          </div>
        ))}
        <button
          type="button"
          disabled={!!pendingAction}
          onClick={() => setOptionModal({ setId: active.id })}
          className="w-[280px] shrink-0 snap-start sm:w-auto sm:shrink border-2 border-dashed border-outline rounded-2xl min-h-[320px] flex flex-col items-center justify-center gap-2 text-on-surface-variant hover:border-primary hover:bg-primary-light hover:text-accent-ink transition-colors disabled:opacity-50"
        >
          <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-2xl font-light">
            +
          </div>
          <div className="font-semibold text-sm">Add option</div>
          <div className="text-xs">Another place you’re considering</div>
        </button>
      </div>

      {decisionModal && (
        <DecisionForm
          trips={trips}
          defaultTripId={selectedTrip || undefined}
          initial={decisionModal === "new" ? null : decisionModal}
          onClose={() => setDecisionModal(null)}
          onSave={saveDecision}
        />
      )}
      {optionModal && (
        <OptionForm
          setId={optionModal.setId}
          initial={optionModal.option || null}
          onClose={() => setOptionModal(null)}
          onSave={saveOption}
        />
      )}
      {bookingDraft && (
        <BookingModal
          booking={bookingDraft}
          selectedTrip={bookingDraft.trip_id}
          tripName={tripName(bookingDraft.trip_id)}
          onClose={() => {
            setBookingDraft(null);
            setLinkingOptionId(null);
          }}
          onSave={handleBookingSave}
          onDelete={async (id) => {
            await deleteBooking(id);
            setBookingDraft(null);
            setLinkingOptionId(null);
          }}
        />
      )}
    </div>
  );
}
