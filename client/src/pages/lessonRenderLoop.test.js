import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// Source-shape assertions, matching the convention in giResponsiveLayout.test.js:
// nothing in this suite renders React, so a render loop cannot be observed here
// directly. What can be pinned is the shape that caused one.
//
// The loop: `course?.topics ?? []` produced a new array on every render while
// `course` was null — the entire time a lesson is loading, and permanently if the
// fetch fails. That array is a dependency of useVideoTopicThumbnails, whose effect
// set state unconditionally, so effect -> setState -> render -> new array -> effect.
// React tears the tree down at the update-depth limit and, with no error boundary,
// the student gets a blank page. It only showed up when the fetch lost the race,
// which is what made it look intermittent and cache-related.

test("the lesson page hands stable array identities to its hooks", () => {
  const source = readFileSync(join(SRC_DIR, "pages", "LessonPage.jsx"), "utf-8");

  assert.match(
    source,
    /const topics = useMemo\(\(\) => course\?\.topics \?\? \[\], \[course\]\)/,
    "topics must be memoised — it is a dependency of useVideoTopicThumbnails",
  );
  assert.match(
    source,
    /const transcriptSegments = useMemo\(\(\) => course\?\.transcriptSegments \?\? \[\], \[course\]\)/,
    "transcriptSegments must be memoised for the same reason",
  );
});

test("the thumbnail effect will not re-render on an unchanged map", () => {
  const source = readFileSync(
    join(SRC_DIR, "hooks", "useVideoTopicThumbnails.js"),
    "utf-8",
  );

  // Defence in depth: even if a caller rebuilds `topics` every render, an equal
  // state must be a wasted render rather than an unbounded loop.
  assert.match(source, /setThumbnails\(\(current\) =>\s*\(?sameThumbnails\(current, initialState\)/);
  assert.doesNotMatch(
    source,
    /^\s*setThumbnails\(initialState\);/m,
    "an unconditional set here is what made the loop unbounded",
  );
});
