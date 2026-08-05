import test from "node:test";
import assert from "node:assert/strict";
import { renderSoftMarkdown } from "../src/lib/soft-markdown.js";

test("preserves explicit ordered-list numbers across blank lines", () => {
  const html = renderSoftMarkdown("1) First\n\n2) Second");

  assert.match(html, /<li value="1"/);
  assert.match(html, /<li value="2"/);
  assert.doesNotMatch(html, /<li value="1"[^>]*>Second/);
});

test("preserves explicit numbers in one contiguous list", () => {
  const html = renderSoftMarkdown("1. First\n2. Second\n4. Fourth");

  assert.match(html, /<li value="1"/);
  assert.match(html, /<li value="2"/);
  assert.match(html, /<li value="4"/);
});
