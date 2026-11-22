import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useTodayKey } from "../src/lib/today.js";
import { APP_LOCALE, HOME_TIME_ZONE } from "../src/lib/locale.js";

// Pages are drawn on the server and then hydrated in the browser; anything
// that reads "today" or formats a date has to come out the same on both, or
// React throws the page away (a hydration error). The server's "today" is the
// home date, whatever the server's own clock zone.

function Today() {
  return createElement("span", null, useTodayKey());
}

test("while rendering on the server, today is the date at home", () => {
  const home = new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  assert.equal(renderToString(createElement(Today)), `<span>${home}</span>`);
});

test("dates are formatted in one fixed locale, whatever the runtime's default", () => {
  const d = new Date(2027, 2, 20, 16, 0);
  assert.equal(d.toLocaleDateString(APP_LOCALE, { weekday: "short", month: "short", day: "numeric" }), "Sat, Mar 20");
  assert.equal(d.toLocaleTimeString(APP_LOCALE, { hour: "numeric", minute: "2-digit" }), "4:00 PM");
});
