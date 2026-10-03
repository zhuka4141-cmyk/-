import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyPointerInput,
  normalizePressure,
  coalescedPointerEvents,
} from "../interaction.js";

test("automatic mode paints with Apple Pencil and orbits with a finger", () => {
  assert.equal(
    classifyPointerInput({ pointerType: "pen", button: 0 }, "auto"),
    "paint",
  );
  assert.equal(
    classifyPointerInput({ pointerType: "touch", button: 0 }, "auto"),
    "orbit",
  );
});

test("manual modes remain available for mouse and stylus workflows", () => {
  assert.equal(
    classifyPointerInput({ pointerType: "mouse", button: 0 }, "paint"),
    "paint",
  );
  assert.equal(
    classifyPointerInput({ pointerType: "mouse", button: 0 }, "orbit"),
    "orbit",
  );
  assert.equal(
    classifyPointerInput({ pointerType: "touch", button: 0 }, "paint"),
    "paint",
  );
  assert.equal(
    classifyPointerInput({ pointerType: "pen", button: 0 }, "orbit"),
    "orbit",
  );
});

test("secondary mouse buttons never start painting", () => {
  assert.equal(
    classifyPointerInput({ pointerType: "mouse", button: 2 }, "paint"),
    null,
  );
  assert.equal(
    classifyPointerInput({ pointerType: "pen", button: 2 }, "auto"),
    null,
  );
});

test("pressure is stable when a device reports no pressure and clamps bad values", () => {
  assert.equal(normalizePressure({ pressure: 0 }, true), 0.65);
  assert.equal(normalizePressure({ pressure: 0.5 }, true), 0.5);
  assert.equal(normalizePressure({ pressure: 2 }, true), 1);
  assert.equal(normalizePressure({ pressure: 0.9 }, false), 0.65);
});

test("coalesced Pencil samples are consumed when the browser exposes them", () => {
  const sample = { pointerType: "pen" };
  assert.deepEqual(coalescedPointerEvents(sample), [sample]);
  const event = {
    getCoalescedEvents: () => [sample, { pointerType: "pen", pressure: 0.8 }],
  };
  assert.equal(coalescedPointerEvents(event).length, 2);
});
