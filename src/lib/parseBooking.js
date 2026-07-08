import { supabase } from './supabase'

// Use CDN worker URL — avoids module worker issues on mobile browsers
const PDFJS_VERSION = '4.8.69'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const PDF_TYPE = 'application/pdf'
const ALLOWED_TYPES = [...IMAGE_TYPES, PDF_TYPE]
const MAX_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * Extract text from a PDF file using pdf.js (lazy-loaded)
 */
async function extractTextFromPDF(file) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const textParts = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items.map((item) => item.str).join(' ')
    if (pageText.trim()) textParts.push(pageText)
  }

  return textParts.join('\n\n')
}

/**
 * Parse a booking from an image or PDF using AI.
 * @param {File} file - Image file (PNG, JPG, WebP) or PDF
 * @param {string} [trip] - Optional trip name for context
 * @returns {Promise<Array>} Array of parsed booking objects
 */
export async function parseBookingFromImage(file, trip) {
  // Validate file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`Unsupported file type: ${file.type}. Please upload a PNG, JPG, WebP, or PDF.`)
  }

  // Validate file size
  if (file.size > MAX_SIZE) {
    throw new Error('File is too large. Maximum size is 10MB.')
  }

  let payload

  if (file.type === PDF_TYPE) {
    // PDF: extract text client-side, send as text (Poe API doesn't accept PDF in vision)
    const text = await extractTextFromPDF(file)
    if (!text || text.trim().length < 20) {
      throw new Error('Could not extract text from PDF. Try taking a screenshot instead.')
    }
    payload = { text, trip: trip || null }
  } else {
    // Image: send as base64 for vision model
    const base64 = await fileToBase64(file)
    payload = { file: base64, mimeType: file.type, trip: trip || null }
  }

  const { data, error } = await supabase.functions.invoke('parse-booking', {
    body: payload,
  })

  if (error) {
    throw new Error(error.message || 'Parse failed')
  }

  if (!data || data.error) {
    throw new Error(data?.error || 'Parse failed')
  }

  // Return the bookings array, each with source set
  return data.bookings.map((booking) => ({
    ...booking,
    source: 'parsed',
    details: booking.details || null,
  }))
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
