import test from "node:test";
import assert from "node:assert/strict";
import { allocateLargestRemainder, assertMinorUnits, sumMinor } from "../../packages/core/money.ts";

 test("largest remainder conserves every minor unit", () => {
  const rows = allocateLargestRemainder(10001, [
    { key: "artist", weight: 6000 },
    { key: "producer", weight: 1500 },
    { key: "manager", weight: 1000 },
    { key: "featured", weight: 500 },
    { key: "reserve", weight: 1000 },
  ]);
  assert.equal(rows.reduce((s, row) => s + row.amountMinor, 0), 10001);
});

test("largest remainder tie breaks deterministically in input order", () => {
  const rows = allocateLargestRemainder(1, [{ key: "a", weight: 1 }, { key: "b", weight: 1 }]);
  assert.deepEqual(rows, [{ key: "a", amountMinor: 1 }, { key: "b", amountMinor: 0 }]);
});

test("minor unit validators reject floating point and negative money", () => {
  assert.throws(() => assertMinorUnits(10.1), /minor units/);
  assert.throws(() => assertMinorUnits(-1), /minor units/);
  assert.equal(sumMinor([1, 2, 3]), 6);
});
