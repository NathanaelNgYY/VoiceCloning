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

test("the staging GI build gates the lesson site behind NTU Microsoft sign-in", () => {
  assert.match(stagingGiEnv, /^VITE_GI_AUTH_ENABLED=true$/m);
  assert.match(configSource, /giAuthEnabled:/);
});

test("the staging GI build carries an Entra config the gate can actually use", () => {
  // VITE_GI_AUTH_ENABLED alone still leaves config.js in "mock" auth mode, and
  // an unpinned authority would accept any Microsoft tenant. Each of these is a
  // silent way for the gate to look enabled while admitting the wrong accounts.
  assert.match(stagingGiEnv, /^VITE_AUTH_MODE=msal$/m);
  assert.match(
    stagingGiEnv,
    /^VITE_ENTRA_CLIENT_ID=9b5c52c0-5f02-4dbf-83ac-c68d246abc68$/m,
  );
  assert.match(
    stagingGiEnv,
    /^VITE_ENTRA_TENANT_AUTHORITY=https:\/\/login\.microsoftonline\.com\/45e82b6b-5ac4-41a7-a36f-e702e5e3a355$/m,
  );
  assert.match(
    stagingGiEnv,
    /^VITE_ENTRA_ALLOWED_EMAIL_DOMAINS=staff\.main\.ntu\.edu\.sg,student\.main\.ntu\.edu\.sg,assoc\.main\.ntu\.edu\.sg$/m,
  );
});

test("the staging GI build requests no API scope the registration cannot issue", () => {
  // httpClient.js attaches a bearer token only when both are set; the NTU
  // registration exposes no custom API, so setting them breaks every API call.
  assert.doesNotMatch(stagingGiEnv, /^VITE_API_AUTH_MODE=/m);
  assert.doesNotMatch(stagingGiEnv, /^VITE_ENTRA_API_SCOPE=/m);
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
