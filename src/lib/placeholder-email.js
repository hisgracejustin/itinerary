/**
 * Members added by name only still need a `users.email` (it's unique and not
 * null, and everything keys on it), so they get an address no one can own:
 * `.invalid` is a top-level domain reserved never to exist (RFC 2606), so no
 * Google account or inbox can have it and nobody can sign in as them. They
 * reach the app through an invite link instead (src/lib/invites.ts).
 *
 * Made-up real-looking addresses (hong@gmail.com) were the workaround before,
 * and each one let whoever really owns that address sign in with Google.
 */
export const PLACEHOLDER_DOMAIN = 'no-email.invalid'

export function isPlaceholderEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith(`@${PLACEHOLDER_DOMAIN}`)
}

/** The address to show for someone: none for a name-only member. */
export function shownEmail(email) {
  return email && !isPlaceholderEmail(email) ? email : null
}

/** A fresh placeholder address for a member called `name`. Unique per call. */
export function placeholderEmail(name) {
  const slug = String(name ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  const suffix = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  return `${slug || 'member'}-${suffix}@${PLACEHOLDER_DOMAIN}`
}
