"use client";

import { useRef, useState } from "react";
import FormModal from "./FormModal";
import TripSelect from "./TripSelect";
import Spinner from "./Spinner";

// The exporter's time zone, so the PDF's dates are their days, not the server's.
function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function filenameFrom(response, fallback) {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get("Content-Disposition") || "");
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      // A malformed header falls back to the generic name.
    }
  }
  return fallback;
}

const fileSize = (bytes) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const canShareFile = (file) => {
  try {
    return typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
};

const INSIDE = [
  "Who pays whom to settle up",
  "Everyone's balance: what they paid and their share",
  "Every shared cost by category, with each person's share",
];

/**
 * Settle up's trip-summary export: one PDF of a whole trip, for sending to
 * someone who isn't on the app. Making the file and sharing it are two taps on
 * purpose: the PDF takes a moment to build, and iOS only opens the share sheet
 * from a fresh tap.
 */
export default function TripSummaryExport({ trips, initialTripId = "", onClose }) {
  const [tripId, setTripId] = useState(initialTripId || (trips.length === 1 ? trips[0].id : ""));
  // idle → creating → ready (holds the file) | error (holds the message)
  const [state, setState] = useState({ status: "idle" });
  const [shareError, setShareError] = useState("");
  // Bumped on every new request or trip change, so a slow response for a trip
  // that's no longer chosen is dropped rather than shown as ready.
  const request = useRef(0);
  const trip = trips.find((t) => t.id === tripId);

  const choose = (id) => {
    request.current += 1;
    setTripId(id);
    setState({ status: "idle" });
    setShareError("");
  };

  const create = async () => {
    if (!tripId || state.status === "creating") return;
    const mine = (request.current += 1);
    const current = () => request.current === mine;
    setState({ status: "creating" });
    setShareError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/summary?tz=${encodeURIComponent(timeZone())}`, { credentials: "same-origin" });
      // An expired session is redirected to the sign-in page, which arrives
      // here as a 200 HTML page, not a PDF.
      const isPdf = (response.headers.get("Content-Type") || "").startsWith("application/pdf");
      if (response.status === 401 || (response.ok && !isPdf)) {
        throw new Error("You've been signed out. Sign in again, then try once more.");
      }
      if (!response.ok) throw new Error("Couldn't make the PDF. Please try again.");
      const blob = await response.blob();
      if (!current()) return;
      const file = new File([blob], filenameFrom(response, "Trip summary.pdf"), { type: "application/pdf" });
      setState({ status: "ready", file });
    } catch (error) {
      if (!current()) return;
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setState({
        status: "error",
        message: offline
          ? "You're offline. The PDF is made on the server, so connect and try again."
          : error instanceof TypeError
            ? "Couldn't reach the server. Please try again."
            : error.message,
      });
    }
  };

  const download = () => {
    const url = URL.createObjectURL(state.file);
    const link = document.createElement("a");
    link.href = url;
    link.download = state.file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const share = async () => {
    setShareError("");
    try {
      await navigator.share({ files: [state.file], title: state.file.name.replace(/\.pdf$/i, "") });
    } catch (error) {
      if (error?.name === "AbortError") return; // closed the share sheet
      setShareError("Sharing didn't open on this device. Download the PDF and send it from there.");
    }
  };

  const ready = state.status === "ready";
  const shareable = ready && canShareFile(state.file);

  return (
    <FormModal
      title="Trip summary PDF"
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          {ready ? (
            <>
              <button type="button" onClick={download} className={shareable ? "mat-btn-outlined" : "mat-btn-filled"}>
                Download
              </button>
              {shareable && (
                <button type="button" onClick={share} className="mat-btn-filled">
                  Share…
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} className="mat-btn-outlined">Cancel</button>
              <button
                type="button"
                onClick={create}
                disabled={!tripId || state.status === "creating"}
                className="mat-btn-filled disabled:opacity-40 inline-flex items-center gap-2"
              >
                {state.status === "creating" && <Spinner size="sm" className="!text-white" />}
                {state.status === "creating" ? "Creating…" : state.status === "error" ? "Try again" : "Create PDF"}
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {trips.length > 1 && <TripSelect trips={trips} value={tripId} onChange={choose} />}

        {ready ? (
          <div className="flex items-center gap-3 rounded-xl border border-outline/30 bg-surface-container/40 p-3">
            <FileIcon />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface break-words">{state.file.name}</p>
              <p className="text-xs text-on-surface-variant">PDF · {fileSize(state.file.size)}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-primary to-primary-dark text-white p-3">
            <FileIcon light />
            <div className="min-w-0">
              <p className="text-sm font-semibold break-words">{trip?.name ?? "Choose a trip"}</p>
              <p className="text-xs text-white/75">One PDF for the whole group</p>
            </div>
          </div>
        )}

        {!ready && (
          <ul className="space-y-1.5">
            {INSIDE.map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm text-on-surface">
                <svg className="w-4 h-4 mt-0.5 shrink-0 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}

        {state.status === "error" && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{state.message}</p>
        )}
        {shareError && (
          <p role="alert" className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">{shareError}</p>
        )}

        <p className="flex items-start gap-2 text-xs text-on-surface-variant">
          <svg className="w-3.5 h-3.5 mt-px shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>
            {ready
              ? "Send it on WhatsApp or email. It's a file, not a link: only the people you send it to can see it."
              : "It's a file, not a link: only the people you send it to can see it."}
          </span>
        </p>
      </div>
    </FormModal>
  );
}

function FileIcon({ light = false }) {
  return (
    <span
      aria-hidden="true"
      className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center ${light ? "bg-white/15" : "bg-red-50"}`}
    >
      <svg className={`w-6 h-6 ${light ? "text-white" : "text-red-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 3v5a1 1 0 001 1h5M9 13h6M9 17h4" />
      </svg>
    </span>
  );
}
