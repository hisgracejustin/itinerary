// Use the self-hosted worker (public/pdf.worker.min.mjs) — avoids CDN/CSP issues.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PDF_TYPE = "application/pdf";
const ALLOWED_TYPES = [...IMAGE_TYPES, PDF_TYPE];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

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
  if (file.size > MAX_SIZE) {
    throw new Error("File is too large. Maximum size is 10MB.");
  }

  let payload: Record<string, unknown>;

  if (file.type === PDF_TYPE) {
    // PDF: extract text client-side (Poe vision doesn't accept PDF), send as text.
    const text = await extractTextFromPDF(file);
    if (!text || text.trim().length < 20) {
      throw new Error("Could not extract text from PDF. Try taking a screenshot instead.");
    }
    payload = { text, trip: trip || null };
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
    throw new Error(data?.error || `Parse failed (${res.status})`);
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
