import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const searchPageSource = readFileSync(new URL("./SearchPage.jsx", import.meta.url), "utf8");
const lessonPageSource = readFileSync(new URL("./LessonPage.jsx", import.meta.url), "utf8");

test("home search form has deliberate space below the supporting text", () => {
  assert.match(
    searchPageSource,
    /<form[^>]*className="[^"]*mt-6[^"]*sm:mt-8[^"]*"/,
  );
});

test("content outline uses a larger section heading than topic labels", () => {
  assert.match(
    lessonPageSource,
    /<h2 className="[^"]*text-lg[^"]*">\s*Content Outline/,
  );
  assert.match(
    lessonPageSource,
    /<h4[\s\S]*?"[^"]*text-xs[^"]*font-semibold[^"]*"/,
  );
});

test("lesson video remains inline when a transcript timestamp starts playback", () => {
  assert.match(lessonPageSource, /<video[\s\S]*?\splaysInline(?:\s|\/?>)/);
});

test("transcript tabs share the full phone width evenly", () => {
  assert.match(
    lessonPageSource,
    /className="[^"]*grid[^"]*w-full[^"]*grid-cols-2[^"]*sm:flex[^"]*sm:w-auto[^"]*"/,
  );
});

test("transcript has a bounded viewport with independent vertical scrolling", () => {
  assert.match(
    lessonPageSource,
    /className="[^"]*h-\[clamp\([^"]*\)[^"]*overflow-hidden[^"]*"/,
  );
  assert.match(
    lessonPageSource,
    /"[^"]*overscroll-contain[^"]*overflow-y-auto[^"]*"/,
  );
});
