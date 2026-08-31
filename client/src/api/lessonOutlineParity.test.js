import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API_DIR = dirname(fileURLToPath(import.meta.url));

// Source-shape assertions, matching the convention in lessonRenderLoop.test.js:
// mockCourseData.js imports a .json without an import attribute, which Vite
// resolves and bare node does not, so the module cannot be imported here.
//
// The regression this pins: the Content Outline and the transcript are the same
// checkpoints, but they were two hand-maintained lists, and they drifted — 8
// coarse outline chapters against 18 transcript sections, so clicking through
// the outline skipped past most of the lesson's sections.

test("the content outline is derived from the transcript segments", () => {
  const source = readFileSync(join(API_DIR, "mockCourseData.js"), "utf-8");

  assert.doesNotMatch(
    source,
    /^\s*topics:\s*\[/m,
    "topics must not be hand-listed beside transcriptSegments — it drifts",
  );
  assert.match(
    source,
    /topics: outlineTopicsFrom\(timedCourse\.transcriptSegments\)/,
    "the served course must derive its outline from its transcript segments",
  );
});

test("every outline topic carries the transcript section's own time and title", () => {
  const source = readFileSync(join(API_DIR, "mockCourseData.js"), "utf-8");
  const body = source.slice(source.indexOf("function outlineTopicsFrom"));

  assert.match(body, /time: segment\.time/, "outline timestamps must be the section's own");
  assert.match(body, /label: segment\.title/, "outline labels must be the section's own title");
});
