import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

// Source-shape assertions, matching lessonRenderLoop.test.js: nothing in this
// suite renders React, so the boundary cannot be exercised here. What can be
// pinned is that it is mounted, and mounted high enough to matter.

test("every build mounts the error boundary", () => {
  const source = readFileSync(join(SRC_DIR, "main.jsx"), "utf-8");

  assert.match(source, /<AppErrorBoundary>/, "the boundary must wrap the app");
  assert.match(
    source,
    /import \{ AppErrorBoundary \} from '@\/components\/AppErrorBoundary\.jsx'/,
  );
});

test("the boundary sits above the router and the providers", () => {
  const source = readFileSync(join(SRC_DIR, "main.jsx"), "utf-8");

  const boundary = source.indexOf("<AppErrorBoundary>");
  const router = source.indexOf("<BrowserRouter");
  const providers = source.indexOf("<AppProviders");

  // A crash during MSAL bootstrap happens before any route renders, so a
  // boundary mounted under the router would never catch it.
  assert.ok(boundary < router, "the boundary must be outside BrowserRouter");
  assert.ok(boundary < providers, "the boundary must be outside AppProviders");
});

test("the fallback does not depend on the app's styling", () => {
  const source = readFileSync(
    join(SRC_DIR, "components", "AppErrorBoundary.jsx"),
    "utf-8",
  );

  // It renders exactly when the app is broken — including when the stylesheet
  // is what broke — so the fallback carries its own inline styles.
  assert.doesNotMatch(
    source,
    /className=/,
    "the fallback must not rely on stylesheet classes",
  );
  assert.match(source, /static getDerivedStateFromError/);
});
