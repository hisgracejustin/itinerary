// Shared config for booking file attachments — imported by the client upload UI
// (input `accept`, size guard, icons) and the server upload route (validation).
// Kept separate from the AI-parse allowlist (image+PDF only) in parseBooking.ts,
// since attachments accept far more document types than the LLM can read.

export const ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

/** MIME types users may attach to a booking. */
export const ATTACHMENT_ALLOWED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-powerpoint", // .ppt
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "text/csv",
  "text/plain",
];

/** Value for a file input's `accept` attribute. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_ALLOWED_TYPES.join(",");

export function isAllowedAttachmentType(type: string): boolean {
  return ATTACHMENT_ALLOWED_TYPES.includes(type);
}

/** Human-readable file size, e.g. "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Emoji icon for an attachment based on its MIME type. */
export function iconForMime(mime: string): string {
  if (!mime) return "📎";
  if (mime === "application/pdf") return "📕";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.includes("spreadsheet") || mime.includes("ms-excel") || mime === "text/csv") return "📊";
  if (mime.includes("word") || mime === "application/msword") return "📝";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "📽️";
  if (mime === "text/plain") return "📄";
  return "📎";
}
