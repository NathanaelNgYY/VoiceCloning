import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const configSource = readFileSync(new URL("./config.js", import.meta.url), "utf8");
const giAppSource = readFileSync(new URL("./GiApp.jsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
const searchPageSource = readFileSync(
  new URL("./pages/SearchPage.jsx", import.meta.url),
  "utf8",
);
const lessonPageSource = readFileSync(
  new URL("./pages/LessonPage.jsx", import.meta.url),
  "utf8",
);
const stagingGiEnv = readFileSync(
  new URL("../env/staging/gi.env", import.meta.url),
  "utf8",
);

test("the staging GI build explicitly disables its authentication gate", () => {
  assert.match(stagingGiEnv, /^VITE_GI_AUTH_ENABLED=false$/m);
  assert.match(configSource, /giAuthEnabled:/);
});

test("public GI visitors bypass protected routes and cannot render the login page", () => {
  assert.match(
    giAppSource,
    /if \(!config\.giAuthEnabled\) \{\s*return children;\s*\}/,
  );
  assert.match(
    giAppSource,
    /path="\/login"[\s\S]*?config\.giAuthEnabled[\s\S]*?<LoginPage \/>[\s\S]*?<Navigate to="\/" replace \/>/,
  );
});

test("the public GI build does not bootstrap Microsoft authentication", () => {
  assert.match(
    mainSource,
    /APP_MODE_CONFIG\.gi && config\.giAuthEnabled && isMsalAuthEnabled\(\)/,
  );
});

test("public search and lesson pages do not offer a nonfunctional sign-out action", () => {
  for (const source of [searchPageSource, lessonPageSource]) {
    assert.match(
      source,
      /config\.giAuthEnabled && auth\.isAuthenticated/,
    );
  }
});
