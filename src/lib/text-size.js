/**
 * The app's text size: a per-device setting (Settings → Text size) for anyone
 * who finds the default too small to read.
 *
 * It sets the root font size, and almost everything in the app is sized in rem
 * (Tailwind's text sizes and spacing, plus every text-[…rem] size), so text,
 * spacing and buttons all grow together. The default sets nothing at all, which
 * keeps the page exactly as it is for everyone who never touches the setting —
 * and keeps the browser's own text-size preference in charge of the base.
 */

/** Percent steps, smallest first. The first one is the default. */
export const TEXT_SIZES = [100, 115, 130, 150]
export const DEFAULT_TEXT_SIZE = TEXT_SIZES[0]

export const TEXT_SIZE_LABELS = { 100: 'Default', 115: 'Large', 130: 'Larger', 150: 'Largest' }

const KEY = 'display.textSize'

/** The saved size for this device, or the default. */
export function readTextSize() {
  try {
    const saved = Number(window.localStorage.getItem(KEY))
    return TEXT_SIZES.includes(saved) ? saved : DEFAULT_TEXT_SIZE
  } catch {
    return DEFAULT_TEXT_SIZE
  }
}

/** Apply `size` to the page right away and remember it on this device. */
export function applyTextSize(size) {
  const root = document.documentElement
  const custom = size !== DEFAULT_TEXT_SIZE && TEXT_SIZES.includes(size)
  if (custom) root.style.fontSize = `${size}%`
  else root.style.removeProperty('font-size')
  try {
    if (custom) window.localStorage.setItem(KEY, String(size))
    else window.localStorage.removeItem(KEY)
  } catch {
    // Storage unavailable (private mode): the size still applies to this visit.
  }
}

/**
 * Inlined into <head> (src/app/layout.tsx) so a saved size applies before the
 * first paint — no flash of small text. Only the non-default sizes do anything.
 */
export const TEXT_SIZE_SCRIPT =
  `try{var s=Number(localStorage.getItem(${JSON.stringify(KEY)}));` +
  `if(${JSON.stringify(TEXT_SIZES.slice(1))}.indexOf(s)>=0)document.documentElement.style.fontSize=s+"%"}catch(e){}`

/**
 * The root font size relative to the usual 16px, for layout math done in px so
 * it grows with the text: 1 at the default size in a default browser.
 */
export function remScale() {
  if (typeof window === 'undefined') return 1
  const px = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize)
  return px > 0 ? px / 16 : 1
}
