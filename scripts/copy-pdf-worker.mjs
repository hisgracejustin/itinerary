// Copy the pdf.js worker from the installed package into public/ so its version
// always matches the API loaded at runtime (pdfjs-dist/legacy/build/pdf.mjs).
// A stale committed worker causes: "The API version X does not match the Worker
// version Y". Runs before every build.
import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const src = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
const dest = new URL("../public/pdf.worker.min.mjs", import.meta.url);

copyFileSync(src, dest);
console.log(`[copy-pdf-worker] ${src} → public/pdf.worker.min.mjs`);
