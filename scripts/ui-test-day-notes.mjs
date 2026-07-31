#!/usr/bin/env node
/**
 * Day-note UI test — the desktop month grid, driven with a REAL mouse.
 *
 * Covers the flow that kept regressing: hover a day square, click the italic
 * note text, then move to the trash and press it (mouse move → down → up, no
 * element.click() shortcut), and confirm the note is gone after a reload.
 *
 * It runs that flow twice:
 *   1. on a day owned by a single trip, and
 *   2. on a HANDOVER day covered by two trips, with the note owned by the
 *      second one — the case that shipped broken three times. The grid used to
 *      re-derive the note's trip from the date, so the write landed in a
 *      different (date, trip_id) slot than the note being edited: the save
 *      inserted a duplicate under the guessed trip and the trash deleted
 *      nothing at all, leaving the note on screen.
 *
 * Usage (defaults to the cached chromium headless shell):
 *   BASE_URL=http://127.0.0.1:3200 \
 *   SESSION_TOKEN=$(cat tok) \
 *   node scripts/ui-test-day-notes.mjs
 *
 * Env:
 *   BASE_URL        app under test            (default http://127.0.0.1:3200)
 *   SESSION_TOKEN   authjs.session-token      (or SESSION_TOKEN_FILE)
 *   ENGINE          chromium | webkit         (default chromium)
 *   BROWSER_PATH    executable override       (default: cached headless shell for chromium)
 *   PLAYWRIGHT_MODULE  path to playwright-core (default: resolved from the repo)
 */
import fs from 'fs'
import { createRequire } from 'module'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3200'
const ENGINE = process.env.ENGINE || 'chromium'
const HOST = new URL(BASE_URL).hostname
const TOKEN = (process.env.SESSION_TOKEN || (process.env.SESSION_TOKEN_FILE ? fs.readFileSync(process.env.SESSION_TOKEN_FILE, 'utf8') : '')).trim()
if (!TOKEN) { console.error('set SESSION_TOKEN or SESSION_TOKEN_FILE'); process.exit(2) }

const require = createRequire(import.meta.url)
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')

const DEFAULT_CHROMIUM = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell`
const launchOpts = ENGINE === 'webkit'
  ? (process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {})
  : { executablePath: process.env.BROWSER_PATH || DEFAULT_CHROMIUM, args: ['--disable-dev-shm-usage', '--disable-gpu'] }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}

const browser = await pw[ENGINE].launch({ headless: true, ...launchOpts })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
await ctx.addCookies([{ name: 'authjs.session-token', value: TOKEN, domain: HOST, path: '/' }])
const pageErrors = []
let page
/** One page per scenario — a long single page eventually OOMs in a small container. */
const freshPage = async () => {
  if (page) await page.close().catch(() => {})
  page = await ctx.newPage()
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))
}
await freshPage()

// ---------- helpers ----------
const settle = (ms = 2200) => page.waitForTimeout(ms)

const MONTH = process.env.TEST_MONTH || 'August 2026'

/**
 * Land on the fixture's month. Paged explicitly rather than "click Next once":
 * selecting a trip snaps the calendar to that trip's start, so the starting
 * month depends on the current scope.
 */
const gotoMonth = async (reload = false) => {
  if (reload) await page.reload({ waitUntil: 'load' })
  else await page.goto(`${BASE_URL}/`, { waitUntil: 'load' })
  await settle(3500)
  // The month title is the h2 in the same header row as the pager (the sidebar
  // has its own "Trips" h2).
  const heading = () => page.evaluate(() => {
    const next = document.querySelector('button[aria-label="Next"]')
    const row = next?.closest('div')?.parentElement
    return row?.querySelector('h2')?.textContent?.trim() || ''
  })
  // "Today" is the only stable anchor: selecting a trip snaps the view to that
  // trip's start, so where we begin depends on the scope. From today, page
  // forward to the fixture month.
  await page.click('button:has-text("Today")').catch(() => {})
  await settle(1200)
  for (let i = 0; i < 18; i++) {
    if ((await heading()).includes(MONTH)) return
    await page.click('button[aria-label="Next"]').catch(() => {})
    await settle(900)
  }
  throw new Error(`could not reach ${MONTH} (header reads "${await heading()}")`)
}
const gotoAug = gotoMonth

const bodyHas = (text) => page.evaluate((t) => document.body.innerText.includes(t), text)
const countOf = (text) => page.evaluate((t) => document.body.innerText.split(t).length - 1, text)

/** Sidebar trip rows, in the order the app lists them. */
const tripNames = () => page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')]
  .map((b) => (b.getAttribute('aria-label') || '').replace(/^(Add|Remove) /, ''))
  .filter(Boolean))

/** Scope the sidebar to exactly one trip, or to All Trips when name is null. */
const selectScope = async (name) => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'All Trips')
    if (b) b.click()
  })
  await settle(1200)
  if (name) {
    await page.click(`button[aria-label="Add ${name}"]`)
    await settle(1500)
  }
}

/**
 * Grid-only lookup: the journey rail renders its own copy of every note.
 * Polled — each cell re-measures how many lines fit after hydration, so the
 * note button can appear a beat after the reload settles.
 */
const gridButtonBox = async (text, timeout = 10000) => {
  const deadline = Date.now() + timeout
  for (;;) {
    const box = await page.evaluate((t) => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.offsetParent && x.textContent.trim() === t && !x.closest('section[data-journey-date]'),
      )
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, text)
    if (box) return box
    if (Date.now() > deadline) return null
    await page.waitForTimeout(400)
  }
}

/** Real mouse press: hover in from above, then down/up on the target. */
const mousePress = async (box, { hoverFirst = true } = {}) => {
  if (hoverFirst) { await page.mouse.move(box.x, box.y - 30); await settle(250) }
  await page.mouse.move(box.x, box.y)
  await settle(200)
  await page.mouse.down()
  await settle(120)
  await page.mouse.up()
}

/** Open the "+" on a specific day number in the grid and type a note. */
const addNoteOnDay = async (dayNumber, text) => {
  let opened = false
  for (let i = 0; i < 20 && !opened; i++) {
    opened = await page.evaluate((d) => {
      const btns = [...document.querySelectorAll('button[title="Add day title"]')]
        .filter((b) => b.offsetParent && !b.closest('section[data-journey-date]'))
      for (const b of btns) {
        const cell = b.closest('div.group')
        if (cell && cell.textContent.trim().startsWith(String(d))) { b.click(); return true }
      }
      return false
    }, dayNumber)
    if (!opened) await page.waitForTimeout(400)
  }
  if (!opened) throw new Error(`no "Add day title" button on day ${dayNumber}`)
  const input = page.locator('input[placeholder="Day title"]').first()
  await input.fill(text)
  await input.press('Enter')
  await settle(2500)
}

/** Click the rendered italic note text with a real mouse to open the editor. */
const openEditor = async (text) => {
  const box = await gridButtonBox(text)
  if (!box) return false
  await mousePress(box)
  await settle(600)
  return page.evaluate(() => !!document.querySelector('input[placeholder="Day title"]'))
}

/** Press the trash with a real mouse — the step that kept failing. */
const pressTrash = async () => {
  const box = await page.evaluate(() => {
    const b = document.querySelector('button[title="Delete day title"]')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (!box) { check('trash button present in the open editor', false); return false }
  await mousePress(box, { hoverFirst: false })
  await settle(2500)
  return true
}

/**
 * The full round trip for one note: add → reload → persists → reopen →
 * trash with a real mouse → gone → reload → still gone.
 */
const runNoteLifecycle = async (label, dayNumber, text) => {
  await gotoAug()
  check(`${label}: fixture starts without the note`, !(await bodyHas(text)))

  await addNoteOnDay(dayNumber, text)
  check(`${label}: note appears after add`, await bodyHas(text))
  await gotoAug(true)
  check(`${label}: note persists across reload`, await bodyHas(text))

  if (!check(`${label}: editor opens on clicking the note text`, await openEditor(text))) return
  await pressTrash()
  check(`${label}: note gone right after the trash`, !(await bodyHas(text)))
  await gotoAug(true)
  check(`${label}: note still gone after reload`, !(await bodyHas(text)))
  check(`${label}: no duplicate left behind`, (await countOf(text)) === 0, `count=${await countOf(text)}`)
}

/**
 * The regression that made the trash a no-op: an EXISTING note is edited before
 * being deleted. If the write targets a date-derived trip instead of the note's
 * own, the edit silently inserts a duplicate under the wrong trip and the
 * delete matches nothing.
 */
const runEditThenDelete = async (label, dayNumber, text) => {
  await gotoAug()
  await addNoteOnDay(dayNumber, text)
  await gotoAug(true)

  if (!check(`${label}: editor opens for the edit`, await openEditor(text))) return
  const input = page.locator('input[placeholder="Day title"]').first()
  // Deliberately NOT a superset of `text`, so "old title is gone" is a real
  // duplicate check: an edit that wrote to the wrong (date, trip_id) slot
  // inserts a second note and leaves the original standing.
  const edited = text.replace('note', 'edited')
  await input.fill(edited)
  await input.press('Enter')
  await settle(2500)
  await gotoAug(true)
  check(`${label}: edited title persists`, await bodyHas(edited))
  check(`${label}: edit updated in place (old title gone)`, !(await bodyHas(text)))

  if (!check(`${label}: editor reopens for the delete`, await openEditor(edited))) return
  await pressTrash()
  check(`${label}: note gone right after the trash`, !(await bodyHas(edited)))
  await gotoAug(true)
  check(`${label}: note still gone after reload`, !(await bodyHas(edited)))
  check(`${label}: nothing left on that day`, !(await bodyHas(text)))
}

/**
 * THE bug the user hit. A note is created while one leg of a split journey is
 * the active scope, so it belongs to THAT trip. He then widens the scope back
 * to All Trips and deletes it from the month grid. With no single selected
 * trip, the grid used to guess the note's trip from the date and picked the
 * OTHER leg (the earlier one also covers the handover day), so the write went
 * to a (date, trip_id) slot that holds nothing: the trash deleted nothing and
 * the note stayed on screen, while the edit quietly inserted a duplicate.
 */
const runCrossScopeDelete = async (label, dayNumber, text, ownerTrip) => {
  await freshPage()
  await gotoAug()

  await selectScope(ownerTrip)
  await gotoAug(true)
  await addNoteOnDay(dayNumber, text)
  check(`${label}: note added under "${ownerTrip}"`, await bodyHas(text))

  // Widen back to All Trips — no single selected trip to resolve from.
  await selectScope(null)
  await gotoAug(true)
  check(`${label}: note visible under All Trips`, await bodyHas(text))

  // The user edits first, then deletes — editing must not fork a duplicate.
  if (!check(`${label}: editor opens under All Trips`, await openEditor(text))) { await selectScope(null); return }
  const input = page.locator('input[placeholder="Day title"]').first()
  const edited = text.replace('note', 'edited')
  await input.fill(edited)
  await input.press('Enter')
  await settle(2500)
  await gotoAug(true)
  check(`${label}: edit updated the SAME note (old title gone)`, !(await bodyHas(text)))
  check(`${label}: edited title visible`, await bodyHas(edited))

  if (!check(`${label}: editor reopens for the delete`, await openEditor(edited))) { await selectScope(null); return }
  await pressTrash()
  check(`${label}: note gone right after the trash`, !(await bodyHas(edited)))
  await gotoAug(true)
  check(`${label}: note still gone after reload`, !(await bodyHas(edited)))
  check(`${label}: no orphan under the other trip`, !(await bodyHas(text)))

  await selectScope(null)
}

// ---------- the runs ----------
console.log(`engine=${ENGINE} base=${BASE_URL}`)
await gotoAug()
console.log(`ua=${(await page.evaluate(() => navigator.userAgent)).slice(0, 72)}`)

// Run-scoped titles so a crashed earlier run can't collide with this one.
const tag = Math.random().toString(36).slice(2, 6)
const names = await tripNames()
console.log(`trips=${JSON.stringify(names)}`)

// Aug 6: inside the first trip only.
await freshPage()
await runNoteLifecycle('single-trip day', 6, `note A ${tag}`)
await freshPage()
await runEditThenDelete('single-trip day, edit then delete', 6, `note B ${tag}`)

// Aug 10: the handover day both trips cover, when the fixture overlaps them.
const overlapDay = Number(process.env.OVERLAP_DAY || 10)
if (process.env.SKIP_OVERLAP !== '1') {
  await freshPage()
  await runNoteLifecycle('overlap day', overlapDay, `note C ${tag}`)
  // The regression: the note belongs to the LATER leg, deleted under All Trips.
  if (names.length >= 2) {
    await runCrossScopeDelete('handover day, note owned by the later leg', overlapDay, `note D ${tag}`, names[1])
  } else {
    console.log('SKIP cross-scope case — fixture needs 2 trips')
  }
}

check('no uncaught page errors', pageErrors.filter((e) => !e.includes('_rsc')).length === 0, pageErrors.slice(0, 3).join(' | '))

await browser.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exit(failures ? 1 : 0)
