// Shared config for option photo uploads — image MIME types only.

import { ATTACHMENT_MAX_LABEL, ATTACHMENT_MAX_SIZE, formatBytes } from "./attachments";

export { ATTACHMENT_MAX_LABEL as OPTION_IMAGE_MAX_LABEL, ATTACHMENT_MAX_SIZE as OPTION_IMAGE_MAX_SIZE, formatBytes };

export const OPTION_IMAGE_ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const OPTION_IMAGE_ACCEPT = OPTION_IMAGE_ALLOWED_TYPES.join(",");

export const OPTION_IMAGE_MAX_COUNT = 8;
export const OPTION_IMAGE_MAX_TOTAL_SIZE = 20 * 1024 * 1024;

export function isAllowedOptionImageType(type: string): boolean {
  return (OPTION_IMAGE_ALLOWED_TYPES as readonly string[]).includes(type);
}

/** Verify image bytes instead of trusting the multipart Content-Type header. */
export function hasValidOptionImageSignature(bytes: Uint8Array, type: string): boolean {
  if (type === "image/png") {
    return (
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
    );
  }
  if (type === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === "image/gif") {
    const header = new TextDecoder("ascii").decode(bytes.subarray(0, 6));
    return header === "GIF87a" || header === "GIF89a";
  }
  if (type === "image/webp") {
    const ascii = (start: number, end: number) =>
      new TextDecoder("ascii").decode(bytes.subarray(start, end));
    return bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  }
  return false;
}
