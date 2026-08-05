import test from "node:test";
import assert from "node:assert/strict";
import { mergeConsideringSets } from "../src/lib/considering-state.js";

const set = (options: unknown[]) => ({ id: "set-1", title: "Decision", options });
const option = (id: string, images: unknown[] = []) => ({ id, title: id, images });

test("server omissions delete stale local options and images", () => {
  const local = [set([option("gone"), option("kept", [{ id: "stale-image" }])])];
  const server = [set([option("kept", [])])];

  const merged = mergeConsideringSets(local, server);

  assert.deepEqual(merged[0].options, [option("kept", [])]);
});

test("only explicitly pending options survive an in-flight server snapshot", () => {
  const local = [
    set([
      option("pending-new", [{ id: "local-image" }]),
      option("stale-local"),
      option("existing", [{ id: "pending-image" }]),
    ]),
  ];
  const server = [set([option("existing", [{ id: "server-image" }])])];

  const merged = mergeConsideringSets(
    local,
    server,
    new Set(["pending-new", "existing"]),
  );

  assert.deepEqual(
    merged[0].options.map((item: { id: string }) => item.id),
    ["existing", "pending-new"],
  );
  assert.deepEqual(
    merged[0].options[0].images.map((image: { id: string }) => image.id),
    ["server-image", "pending-image"],
  );
});
