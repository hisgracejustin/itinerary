import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { signIn, signInWithPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    try {
      if (password) {
        await signInWithPassword(email.trim(), password)
      } else {
        await signIn(email.trim())
        setSent(true)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-dim p-4">
      <div className="w-full max-w-sm mat-surface p-8 rounded-2xl">
        <h1 className="text-2xl font-medium text-on-surface mb-2">Itinerary</h1>
        <p className="text-sm text-on-surface-variant mb-6">Sign in to access your trips</p>

        {sent ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm text-on-surface font-medium mb-1">Check your email</p>
            <p className="text-xs text-on-surface-variant">
              We sent a magic link to <strong>{email}</strong>
            </p>
            <button
              onClick={() => { setSent(false); setEmail('') }}
              className="mt-4 text-xs text-primary hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mat-input w-full"
                autoFocus
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                Password <span className="text-on-surface-variant/60">(optional)</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave empty for magic link"
                className="mat-input w-full"
              />
            </div>

            {error && (
              <p className="text-xs text-red-500">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="mat-btn-filled w-full"
            >
              {loading ? 'Signing in...' : (password ? 'Sign in' : 'Send magic link')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
