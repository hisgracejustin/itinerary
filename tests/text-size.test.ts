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
  syncTextSize,
} from "../src/lib/text-size.js";

// The text-size setting scales the root font size; the default must set
// nothing at all, so the app looks exactly as it does without the setting.

/**
 * A stand-in for the bits of the browser the setting touches. `basePx` is the
 * browser's own default font size (16px unless someone changed it).
 */
function fakeBrowser(saved: string | null, { storageThrows = false, basePx = 16 } = {}) {
  const store = new Map<string, string>();
  if (saved !== null) store.set("display.textSize", saved);
  const attrs = new Set<string>();
  const style = {
    fontSize: "",
    removeProperty(name: string) {
      if (name === "font-size") style.fontSize = "";
    },
  };
  const getComputedStyle = () => ({
    fontSize: `${basePx * (style.fontSize ? Number.parseFloat(style.fontSize) / 100 : 1)}px`,
  });
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
  const documentElement = {
    style,
    setAttribute: (name: string) => void attrs.add(name),
    toggleAttribute: (name: string, on: boolean) => {
      if (on) attrs.add(name);
      else attrs.delete(name);
      return on;
    },
  };
  const document = { documentElement };
  const window = { localStorage, getComputedStyle };
  return { store, style, attrs, localStorage, document, window, getComputedStyle };
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
    vm.runInNewContext(TEXT_SIZE_SCRIPT, {
      localStorage: b.localStorage,
      document: b.document,
      getComputedStyle: b.getComputedStyle,
    });
    return { fontSize: b.style.fontSize, large: b.attrs.has("data-large-text") };
  };
  assert.deepEqual(run("115"), { fontSize: "115%", large: true });
  assert.deepEqual(run("130"), { fontSize: "130%", large: true });
  assert.deepEqual(run("150"), { fontSize: "150%", large: true });
  // Default and anything unexpected leave the page untouched.
  for (const saved of [null, "100", "", "abc", "999", "130.5", "-130"]) {
    assert.deepEqual(run(saved), { fontSize: "", large: false }, `saved ${JSON.stringify(saved)} should change nothing`);
  }
  // A browser already set to bigger text gets the roomier layouts too.
  assert.deepEqual(run(null, { basePx: 20 }), { fontSize: "", large: true });
  // Blocked storage (private mode) mustn't throw before the page renders.
  assert.deepEqual(run("130", { storageThrows: true }), { fontSize: "", large: false });
});

test("applyTextSize resizes the page at once and remembers it; the default clears both", () => {
  const b = fakeBrowser(null);
  withBrowser(b, () => {
    applyTextSize(130);
    assert.equal(b.style.fontSize, "130%");
    assert.equal(b.attrs.has("data-large-text"), true);
    assert.equal(b.store.get("display.textSize"), "130");
    assert.equal(readTextSize(), 130);

    applyTextSize(DEFAULT_TEXT_SIZE);
    assert.equal(b.style.fontSize, "");
    assert.equal(b.attrs.has("data-large-text"), false);
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

test("syncTextSize puts a saved size back after React resets <html>, and does nothing by default", () => {
  const b = fakeBrowser("130");
  // As if React had re-rendered the document and cleared <html>'s attributes.
  withBrowser(b, syncTextSize);
  assert.equal(b.style.fontSize, "130%");
  assert.equal(b.attrs.has("data-large-text"), true);

  const plain = fakeBrowser(null);
  withBrowser(plain, syncTextSize);
  assert.equal(plain.style.fontSize, "");
  assert.equal(plain.attrs.has("data-large-text"), false);
  assert.equal(plain.store.size, 0);
});

test("the default size keeps a browser's own bigger text in large-text mode", () => {
  const b = fakeBrowser(null, { basePx: 20 });
  withBrowser(b, () => applyTextSize(DEFAULT_TEXT_SIZE));
  assert.equal(b.style.fontSize, "");
  assert.equal(b.attrs.has("data-large-text"), true);
});

test("remScale is the root font size over 16px, and 1 on the server", () => {
  assert.equal(remScale(), 1);
  assert.equal(withBrowser(fakeBrowser(null), remScale), 1);
  const b = fakeBrowser(null);
  b.style.fontSize = "130%";
  assert.equal(withBrowser(b, remScale), 1.3);
  assert.equal(withBrowser(fakeBrowser(null, { basePx: 20 }), remScale), 1.25);
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
