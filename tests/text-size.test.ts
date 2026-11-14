import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  DEFAULT_TEXT_SIZE,
  TEXT_SIZES,
  TEXT_SIZE_SCRIPT,
  applyTextSize,
  readTextSize,
  remScale,
} from "../src/lib/text-size.js";

// The text-size setting scales the root font size; the default must set
// nothing at all, so the app looks exactly as it does without the setting.

/** A stand-in for the bits of the browser the setting touches. */
function fakeBrowser(saved: string | null, { storageThrows = false, rootPx = "16px" } = {}) {
  const store = new Map<string, string>();
  if (saved !== null) store.set("display.textSize", saved);
  const style = {
    fontSize: "",
    removeProperty(name: string) {
      if (name === "font-size") style.fontSize = "";
    },
  };
  const localStorage = {
    getItem: (k: string) => {
      if (storageThrows) throw new Error("blocked");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (storageThrows) throw new Error("blocked");
      store.set(k, v);
    },
    removeItem: (k: string) => {
      if (storageThrows) throw new Error("blocked");
      store.delete(k);
    },
  };
  const document = { documentElement: { style } };
  const window = { localStorage, getComputedStyle: () => ({ fontSize: rootPx }) };
  return { store, style, localStorage, document, window };
}

/** Run `fn` with the fake browser installed as globals. */
function withBrowser<T>(b: ReturnType<typeof fakeBrowser>, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const before = { window: g.window, document: g.document };
  g.window = b.window;
  g.document = b.document;
  try {
    return fn();
  } finally {
    g.window = before.window;
    g.document = before.document;
  }
}

test("the head script applies a saved larger size, and nothing otherwise", () => {
  const run = (saved: string | null, opts = {}) => {
    const b = fakeBrowser(saved, opts);
    vm.runInNewContext(TEXT_SIZE_SCRIPT, { localStorage: b.localStorage, document: b.document });
    return b.style.fontSize;
  };
  assert.equal(run("115"), "115%");
  assert.equal(run("130"), "130%");
  assert.equal(run("150"), "150%");
  // Default and anything unexpected leave the page untouched.
  for (const saved of [null, "100", "", "abc", "999", "130.5", "-130"]) {
    assert.equal(run(saved), "", `saved ${JSON.stringify(saved)} should change nothing`);
  }
  // Blocked storage (private mode) mustn't throw before the page renders.
  assert.equal(run("130", { storageThrows: true }), "");
});

test("applyTextSize resizes the page at once and remembers it; the default clears both", () => {
  const b = fakeBrowser(null);
  withBrowser(b, () => {
    applyTextSize(130);
    assert.equal(b.style.fontSize, "130%");
    assert.equal(b.store.get("display.textSize"), "130");
    assert.equal(readTextSize(), 130);

    applyTextSize(DEFAULT_TEXT_SIZE);
    assert.equal(b.style.fontSize, "");
    assert.equal(b.store.has("display.textSize"), false);
    assert.equal(readTextSize(), DEFAULT_TEXT_SIZE);

    // A size that isn't one of the steps is treated as the default.
    applyTextSize(175);
    assert.equal(b.style.fontSize, "");
  });
});

test("readTextSize falls back to the default for missing, unknown or unreadable values", () => {
  for (const saved of [null, "abc", "175", "100"]) {
    assert.equal(withBrowser(fakeBrowser(saved), readTextSize), DEFAULT_TEXT_SIZE);
  }
  assert.equal(withBrowser(fakeBrowser("130", { storageThrows: true }), readTextSize), DEFAULT_TEXT_SIZE);
  for (const size of TEXT_SIZES) assert.equal(withBrowser(fakeBrowser(String(size)), readTextSize), size);
});

test("remScale is the root font size over 16px, and 1 on the server", () => {
  assert.equal(remScale(), 1);
  assert.equal(withBrowser(fakeBrowser(null, { rootPx: "16px" }), remScale), 1);
  assert.equal(withBrowser(fakeBrowser(null, { rootPx: "20.8px" }), remScale), 1.3);
  assert.equal(withBrowser(fakeBrowser(null, { rootPx: "" }), remScale), 1);
});

test("no fixed-pixel text sizes in the app: they wouldn't grow with the setting", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
        fs.readFileSync(full, "utf8").split("\n").forEach((line, i) => {
          if (/(^|[^\w-])text-\[\d+(\.\d+)?px\]/.test(line)) offenders.push(`${full}:${i + 1}`);
        });
      }
    }
  };
  walk(path.join(import.meta.dirname, "..", "src"));
  assert.deepEqual(offenders, [], "use rem, e.g. text-[0.6875rem] for 11px");
});
