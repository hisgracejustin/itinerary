import { useState, useEffect, useCallback, useRef } from 'react'
import { getBookingAttachmentsAction } from '@/actions/attachments'
import { unwrap } from '@/lib/friendlyError'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_SIZE,
  isAllowedAttachmentType,
  formatBytes,
  iconForMime,
} from '@/lib/attachments'
import { useToast } from './Toast'

/**
 * Attachments list + uploader for a booking.
 *  - mode="view": read-only list with View / Download links.
 *  - mode="edit": adds an upload control and per-file delete.
 *    When `bookingId` is null (a new, unsaved booking) files are held in
 *    `stagedFiles` and uploaded by the parent modal after the booking is created.
 */
export default function AttachmentsSection({ bookingId, mode = 'view', stagedFiles = [], setStagedFiles }) {
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(!!bookingId)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)
  const { toast } = useToast()
  const editable = mode === 'edit'

  const load = useCallback(async () => {
    if (!bookingId) {
      setAttachments([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const rows = unwrap(await getBookingAttachmentsAction(bookingId))
      setAttachments(rows)
    } catch {
      // Non-fatal — surface an empty list rather than blocking the modal.
      setAttachments([])
    } finally {
      setLoading(false)
    }
  }, [bookingId])

  useEffect(() => { load() }, [load])

  const validate = (file) => {
    if (!isAllowedAttachmentType(file.type)) {
      toast.error(`Unsupported file type: ${file.name}`)
      return false
    }
    if (file.size > ATTACHMENT_MAX_SIZE) {
      toast.error(`"${file.name}" is too large (max 10MB)`)
      return false
    }
    return true
  }

  const uploadOne = async (file) => {
    const body = new FormData()
    body.append('booking_id', bookingId)
    body.append('file', file)
    const res = await fetch('/api/attachments', { method: 'POST', body })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`)
    return data
  }

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(validate)
    if (files.length === 0) return

    if (!bookingId) {
      // New booking — stage for upload after it's created.
      setStagedFiles?.((prev) => [...prev, ...files])
      return
    }

    setUploading(true)
    try {
      for (const file of files) await uploadOne(file)
      await load()
      toast.success(files.length === 1 ? 'File attached' : `${files.length} files attached`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`/api/attachments/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Delete failed (${res.status})`)
      }
      setAttachments((prev) => prev.filter((a) => a.id !== id))
      toast.success('Attachment removed')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const removeStaged = (idx) => {
    setStagedFiles?.((prev) => prev.filter((_, i) => i !== idx))
  }

  const hasAny = attachments.length > 0 || stagedFiles.length > 0

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
        Attachments
      </h3>

      {loading ? (
        <p className="text-xs text-on-surface-variant">Loading…</p>
      ) : !hasAny ? (
        <p className="text-xs text-on-surface-variant/70">
          {editable ? 'No files yet. Add a document below.' : 'No attachments.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-lg border border-outline/20 px-3 py-2"
            >
              <span className="text-lg shrink-0">{iconForMime(a.mime_type)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-on-surface truncate">{a.filename}</p>
                <p className="text-[10px] text-on-surface-variant">{formatBytes(a.size_bytes)}</p>
              </div>
              <a
                href={`/api/attachments/${a.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-primary hover:underline px-1.5 py-1"
                title="View"
              >
                View
              </a>
              <a
                href={`/api/attachments/${a.id}?download=1`}
                className="text-xs font-medium text-on-surface-variant hover:text-on-surface px-1.5 py-1"
                title="Download"
              >
                Download
              </a>
              {editable && (
                <button
                  type="button"
                  onClick={() => handleDelete(a.id)}
                  className="text-on-surface-variant/50 hover:text-red-600 transition-colors p-1"
                  title="Delete"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </li>
          ))}

          {/* Staged (not-yet-uploaded) files for a new booking */}
          {stagedFiles.map((f, i) => (
            <li
              key={`staged-${i}`}
              className="flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary-light/30 px-3 py-2"
            >
              <span className="text-lg shrink-0">{iconForMime(f.type)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-on-surface truncate">{f.name}</p>
                <p className="text-[10px] text-on-surface-variant">{formatBytes(f.size)} · pending</p>
              </div>
              {editable && (
                <button
                  type="button"
                  onClick={() => removeStaged(i)}
                  className="text-on-surface-variant/50 hover:text-red-600 transition-colors p-1"
                  title="Remove"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:bg-primary-light/50 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {uploading ? 'Uploading…' : 'Add attachment'}
          </button>
          <p className="text-[10px] text-on-surface-variant/60">
            PDF, images, Word, Excel, CSV, etc. · Max 10MB each
          </p>
        </>
      )}
    </div>
  )
}
