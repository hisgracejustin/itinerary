import { useState, useRef, useEffect } from 'react'
import { parseBookingFromImage } from '../lib/parseBooking'

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf'

export default function UploadBooking({ trip, onParsed }) {
  const [status, setStatus] = useState('idle') // idle | preview | parsing | error
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  // Transient message under the paste button ("No image on the clipboard").
  const [pasteHint, setPasteHint] = useState(null)
  // Whether the async Clipboard API is usable — the touch path, where there is
  // no Cmd/Ctrl+V. Detected after mount (SSR has no navigator).
  const [canClipboardRead, setCanClipboardRead] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    setCanClipboardRead(typeof navigator !== 'undefined' && !!navigator.clipboard?.read)
  }, [])

  const isPDF = file?.type === 'application/pdf'

  const handleFile = (f) => {
    if (!f) return
    setFile(f)
    if (f.type === 'application/pdf') {
      setPreview(null) // PDFs don't get image preview
    } else {
      setPreview(URL.createObjectURL(f))
    }
    setStatus('preview')
    setError(null)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => setDragOver(false)

  // Paste-to-upload: a screenshot on the clipboard (Cmd/Ctrl+V) is the fastest
  // path from a confirmation email to a parsed booking. Document-wide listener
  // because the drop zone isn't focusable — scoping it there would require a
  // click first. Only fires on image clipboards; anything else passes through.
  // Pasting over an existing selection replaces it; ignored mid-parse so a
  // stray paste can't yank the file out from under the running request.
  useEffect(() => {
    if (status === 'parsing') return
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
      const f = item?.getAsFile()
      if (!f) return
      e.preventDefault()
      handleFile(f)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [status])

  const handleInputChange = (e) => {
    handleFile(e.target.files[0])
  }

  // Button variant of paste for touch devices. Must run inside the tap's user
  // gesture — iOS shows its native "Paste" permission bubble on clipboard.read.
  const handlePasteButton = async (e) => {
    // Guard against ever being nested in the click-to-browse drop zone.
    e.stopPropagation()
    setPasteHint(null)
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) {
          const blob = await item.getType(type)
          const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg')
          handleFile(new File([blob], `pasted-screenshot.${ext}`, { type }))
          return
        }
      }
      setPasteHint('No image on the clipboard — copy a screenshot first')
    } catch {
      // Permission denied or the platform withheld the clipboard.
      setPasteHint('Clipboard access was blocked')
    }
  }

  const handleParse = async () => {
    setStatus('parsing')
    setError(null)
    try {
      const bookings = await parseBookingFromImage(file, trip)
      // Pass the original document up so it's attached to the resulting booking(s).
      onParsed(bookings, file)
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  const handleReset = () => {
    setFile(null)
    setPreview(null)
    setStatus('idle')
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  // Idle state — drop zone
  if (status === 'idle') {
    return (
      <div className="space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
          dragOver
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
        }`}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={handleInputChange}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">
              Drop a file, paste a screenshot, or click to browse
            </p>
            <p className="text-xs text-gray-400 mt-1">
              PNG, JPG, WebP, or PDF • Max 10MB
            </p>
          </div>
        </div>
      </div>
      {/* The touch path: no Cmd/Ctrl+V on a phone, so a tap that reads the
          clipboard directly (iOS shows its native Paste confirmation). */}
      {canClipboardRead && (
        <div className="text-center">
          <button
            type="button"
            onClick={handlePasteButton}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Paste screenshot
          </button>
          {pasteHint && (
            <p className="text-xs text-amber-600 mt-2">{pasteHint}</p>
          )}
        </div>
      )}
      </div>
    )
  }

  // Preview state — show image/PDF + parse button
  if (status === 'preview') {
    return (
      <div className="space-y-4">
        <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
          {isPDF ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <div className="w-12 h-12 rounded-lg bg-red-50 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-xs font-medium text-gray-600">PDF Document</span>
              <span className="text-[10px] text-gray-400">Text will be extracted locally</span>
            </div>
          ) : (
            <img
              src={preview}
              alt="Booking screenshot"
              className="w-full max-h-64 object-contain"
            />
          )}
          <button
            onClick={handleReset}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            title="Remove"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-500 truncate">{file.name}</p>
        <button
          onClick={handleParse}
          className="w-full py-2.5 px-4 rounded-full text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] transition-all shadow-md flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Parse with AI
        </button>
      </div>
    )
  }

  // Parsing state — loading
  if (status === 'parsing') {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="w-10 h-10 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">AI is reading your booking...</p>
          <p className="text-xs text-gray-400 mt-1">This usually takes a few seconds</p>
        </div>
      </div>
    )
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-red-800">Failed to parse</p>
              <p className="text-xs text-red-600 mt-1">{error}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleReset}
            className="flex-1 py-2 px-4 rounded-full text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Try Different File
          </button>
          <button
            onClick={handleParse}
            className="flex-1 py-2 px-4 rounded-full text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-all"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return null
}
