// Use the self-hosted worker (public/pdf.worker.min.mjs) — avoids CDN/CSP issues.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PDF_TYPE = "application/pdf";
const ALLOWED_TYPES = [...IMAGE_TYPES, PDF_TYPE];
// Vercel caps request bodies at 4.5MB and base64 inflates by ~33%, so an image
// larger than this can't reach the route at all. The route enforces the same.
const MAX_SIZE = 3 * 1024 * 1024;
// A PDF is never uploaded — only the text extracted from it — so its ceiling is
// about how much pdf.js should chew through on a phone, not the body cap.
const MAX_PDF_SIZE = 10 * 1024 * 1024;
// Matches MAX_TEXT_LENGTH in the route, which rejects anything longer.
const MAX_TEXT_LENGTH = 200_000;

/** Extract text from a PDF file using pdf.js (lazy-loaded). */
async function extractTextFromPDF(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Pin the worker URL to the API version so it can never mismatch and so a
  // version bump busts any HTTP/service-worker cache of the old worker.
  pdfjsLib.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs?v=${pdfjsLib.version}`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const textParts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    if (pageText.trim()) textParts.push(pageText);
  }

  return textParts.join("\n\n");
}

/**
 * Parse a booking from an image or PDF using AI (server route /api/parse-booking).
 * Returns an array of parsed booking objects.
 */
export async function parseBookingFromImage(file: File, trip?: string | null) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`Unsupported file type: ${file.type}. Please upload a PNG, JPG, WebP, or PDF.`);
  }
  const isPdf = file.type === PDF_TYPE;
  const maxSize = isPdf ? MAX_PDF_SIZE : MAX_SIZE;
  if (file.size > maxSize) {
    throw new Error(`File is too large. Maximum size is ${isPdf ? "10MB" : "3MB"}.`);
  }

  let payload: Record<string, unknown>;

  if (isPdf) {
    // PDF: extract text client-side (Poe vision doesn't accept PDF), send as text.
    const text = await extractTextFromPDF(file);
    if (!text || text.trim().length < 20) {
      throw new Error("Could not extract text from PDF. Try taking a screenshot instead.");
    }
    payload = { text: text.slice(0, MAX_TEXT_LENGTH), trip: trip || null };
  } else {
    const base64 = await fileToBase64(file);
    payload = { file: base64, mimeType: file.type, trip: trip || null };
  }

  const res = await fetch("/api/parse-booking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data || data.error) {
    // The route always sends an `error` field; these fallbacks cover the cases
    // where the platform rejects the request before it reaches the route.
    const fallback =
      res.status === 413 ? "That file is too large to parse — try a smaller screenshot."
      : res.status === 429 ? "Parse limit reached — try again in a while."
      : res.status === 504 ? "The parsing service took too long — try again."
      : `Parse failed (${res.status})`;
    throw new Error(data?.error || fallback);
  }

  return (data.bookings as Array<Record<string, unknown>>).map((booking) => ({
    ...booking,
    source: "parsed",
    details: booking.details || null,
  }));
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
