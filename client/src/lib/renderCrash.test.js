import test from "node:test";
import assert from "node:assert/strict";
import { describeRenderCrash } from "./renderCrash.js";

test("names the error and its message", () => {
  assert.equal(
    describeRenderCrash(new ReferenceError("Cannot access 'x' before initialization")),
    "ReferenceError: Cannot access 'x' before initialization",
  );
});

test("falls back to the error name when there is no message", () => {
  assert.equal(describeRenderCrash(new TypeError("")), "TypeError");
});

test("passes a thrown string through", () => {
  assert.equal(describeRenderCrash("  boom  "), "boom");
});

test("never renders [object Object]", () => {
  assert.equal(describeRenderCrash({ code: 42 }), '{"code":42}');
});

test("survives values that cannot be serialized", () => {
  const circular = {};
  circular.self = circular;
  assert.equal(describeRenderCrash(circular), "Unknown error");

  const hostile = {
    get anything() {
      throw new Error("getter exploded");
    },
  };
  assert.equal(describeRenderCrash(hostile), "Unknown error");
});

test("handles the empty cases without throwing", () => {
  for (const value of [null, undefined, "", "   ", {}, 0]) {
    assert.equal(describeRenderCrash(value), "Unknown error");
  }
});
