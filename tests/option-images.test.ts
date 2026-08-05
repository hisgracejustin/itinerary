import test from "node:test";
import assert from "node:assert/strict";
import {
  hasValidOptionImageSignature,
  OPTION_IMAGE_MAX_COUNT,
  OPTION_IMAGE_MAX_TOTAL_SIZE,
} from "../src/lib/option-images";

test("validates image signatures instead of trusting MIME type", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
  const gif = new TextEncoder().encode("GIF89a");
  const webp = new TextEncoder().encode("RIFF0000WEBP");

  assert.equal(hasValidOptionImageSignature(png, "image/png"), true);
  assert.equal(hasValidOptionImageSignature(jpeg, "image/jpeg"), true);
  assert.equal(hasValidOptionImageSignature(gif, "image/gif"), true);
  assert.equal(hasValidOptionImageSignature(webp, "image/webp"), true);
  assert.equal(hasValidOptionImageSignature(new TextEncoder().encode("<script>"), "image/png"), false);
  assert.equal(hasValidOptionImageSignature(png, "image/jpeg"), false);
});

test("defines bounded per-option image storage", () => {
  assert.equal(OPTION_IMAGE_MAX_COUNT, 8);
  assert.equal(OPTION_IMAGE_MAX_TOTAL_SIZE, 20 * 1024 * 1024);
});
