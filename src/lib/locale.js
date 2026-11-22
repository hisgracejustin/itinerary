/**
 * One locale for every date, time and number the app formats, and one place
 * "today" starts from, so the server's HTML and the browser's first render say
 * the same thing.
 *
 * Formatting in the browser's own locale made the two differ ("Mar 20" from the
 * server, "20 Mar" on an en-HK phone; "4:00 PM" against "4:00 pm"), and so did
 * reading the browser's clock (the server, on UTC, is still on the 21st for
 * the first eight hours of the 22nd in Hong Kong). React then threw the page
 * away and drew it again in the browser — a hydration error — every time.
 *
 * en-US is what the server always rendered, so the first paint is unchanged.
 */
export const APP_LOCALE = 'en-US'

/**
 * The group's home clock. "Today" is read here while a page is rendered on the
 * server and hydrated (see ./today), and app-wide timestamps (when the rates
 * were fetched) are shown in it, so both sides agree.
 */
export const HOME_TIME_ZONE = 'Asia/Hong_Kong'
