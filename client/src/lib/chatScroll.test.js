import assert from "node:assert/strict";
import test from "node:test";

import { chatGrowthKey, isNearBottom, STICK_TO_BOTTOM_THRESHOLD_PX } from "./chatScroll.js";

test("a viewport scrolled to its exact bottom counts as near bottom", () => {
  assert.equal(isNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 }), true);
});

test("a viewport within the threshold still counts as near bottom", () => {
  const scrollTop = 600 - (STICK_TO_BOTTOM_THRESHOLD_PX - 1);

  assert.equal(isNearBottom({ scrollTop, scrollHeight: 1000, clientHeight: 400 }), true);
});

test("a viewport scrolled up past the threshold does not count as near bottom", () => {
  assert.equal(isNearBottom({ scrollTop: 200, scrollHeight: 1000, clientHeight: 400 }), false);
});

test("a viewport with nothing to scroll counts as near bottom", () => {
  assert.equal(isNearBottom({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 }), true);
});

test("a missing viewport does not count as near bottom", () => {
  assert.equal(isNearBottom(null), false);
});

test("growth key changes when a reply streams more text in", () => {
  const before = chatGrowthKey([{ id: "a", text: "You're around four" }], "speaking");
  const after = chatGrowthKey([{ id: "a", text: "You're around four thirty-three" }], "speaking");

  assert.notEqual(before, after);
});

test("growth key changes when a new message arrives", () => {
  const before = chatGrowthKey([{ id: "a", text: "hi" }], "idle");
  const after = chatGrowthKey([{ id: "a", text: "hi" }, { id: "b", text: "" }], "idle");

  assert.notEqual(before, after);
});

test("growth key is stable when nothing has changed", () => {
  const messages = [{ id: "a", text: "hi" }];

  assert.equal(chatGrowthKey(messages, "idle"), chatGrowthKey(messages, "idle"));
});

test("growth key tolerates an empty transcript", () => {
  assert.equal(typeof chatGrowthKey([], ""), "string");
  assert.equal(typeof chatGrowthKey(undefined), "string");
});
