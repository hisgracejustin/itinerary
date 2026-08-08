import test from "node:test";
import assert from "node:assert/strict";
import { isTripWritable, writableTripsInSelection } from "../src/lib/trip-permissions.js";

const trips = [
  { id: "owned", myRole: "owner" },
  { id: "editable", myRole: "editor" },
  { id: "view-only", myRole: "viewer" },
];

test("only owners and editors can write trips", () => {
  assert.equal(isTripWritable(trips[0]), true);
  assert.equal(isTripWritable(trips[1]), true);
  assert.equal(isTripWritable(trips[2]), false);
});

test("global create trips stay inside the active filter", () => {
  assert.deepEqual(
    writableTripsInSelection(trips, ["editable", "view-only"]).map((trip) => trip.id),
    ["editable"],
  );
});

test("All Trips includes every writable trip", () => {
  assert.deepEqual(
    writableTripsInSelection(trips, []).map((trip) => trip.id),
    ["owned", "editable"],
  );
});
