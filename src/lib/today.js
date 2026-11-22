import { useMemo, useSyncExternalStore } from 'react'
import { HOME_TIME_ZONE } from './locale'

const pad = (n) => String(n).padStart(2, '0')

/** The device's own calendar date, 'YYYY-MM-DD'. */
function deviceDay() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const homeFormat = new Intl.DateTimeFormat('en-CA', { timeZone: HOME_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
/** Today's date at home, 'YYYY-MM-DD': what the server renders with. */
function homeDay() {
  return homeFormat.format(new Date())
}

/** Re-read at the next local midnight and whenever the tab comes back, so a page left open overnight moves on. */
function subscribe(onChange) {
  let timer
  const arm = () => {
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    timer = setTimeout(() => {
      onChange()
      arm()
    }, midnight - now + 1000)
  }
  arm()
  const onVisible = () => {
    if (document.visibilityState === 'visible') onChange()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/**
 * Today as 'YYYY-MM-DD'. While the server renders and the browser hydrates it's
 * the home date, so both draw the same page; straight after, it's the device's
 * own date (a traveller's "today"), which React applies as an ordinary update
 * rather than a hydration error.
 */
export function useTodayKey() {
  return useSyncExternalStore(subscribe, deviceDay, homeDay)
}

/** Today at local midnight, for date comparisons (isSameDay and the like). */
export function useToday() {
  const key = useTodayKey()
  return useMemo(() => new Date(`${key}T00:00:00`), [key])
}
