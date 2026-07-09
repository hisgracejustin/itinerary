"use client"

import { useState, useEffect } from 'react'

/**
 * SSR-safe media-query hook. Starts false on the server / first client render,
 * then syncs to the real match after mount (so components can branch layout on
 * viewport width without a hydration mismatch).
 */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
