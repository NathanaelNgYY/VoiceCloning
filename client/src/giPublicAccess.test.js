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
// Reaching outside client/ on purpose: the scope the browser requests and the
// audience the backends verify are one invariant spread across three packages
// that deploy independently, and nothing else checks them against each other.
const stagingGatewayEnv = readFileSync(
  new URL("../../live-gateway/.env.livegateway.deployment.staging", import.meta.url),
  "utf8",
);
const stagingLambdaEnv = readFileSync(
  new URL("../../lambda/.env.deployment.staging", import.meta.url),
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

test("the staging GI build requests the API scope its backends verify against", () => {
  // shouldAttachApiAccessToken() needs BOTH before it attaches anything, so half
  // this pair is indistinguishable from a frontend-only gate: the browser signs
  // in, the socket sends no session.auth, and the gateway rejects it.
  assert.match(stagingGiEnv, /^VITE_API_AUTH_MODE=entra$/m);
  assert.match(
    stagingGiEnv,
    /^VITE_ENTRA_API_SCOPE=api:\/\/9b5c52c0-5f02-4dbf-83ac-c68d246abc68\/access_as_user$/m,
  );
});

test("the requested API scope matches the audience the gateway checks", () => {
  // entraToken.js rejects any token whose `aud` is not ENTRA_AUDIENCE. The scope
  // the client asks for and the audience the gateway expects are configured in
  // two different files, so drift between them looks like a broken sign-in
  // rather than a config mismatch. api://<id>/<scope> must reduce to api://<id>.
  const scope = stagingGiEnv.match(/^VITE_ENTRA_API_SCOPE=(.+)$/m)?.[1] ?? "";
  const audience = scope.slice(0, scope.lastIndexOf("/"));
  assert.ok(audience.startsWith("api://"), `expected an api:// scope, got "${scope}"`);

  const expectsAudience = new RegExp(
    `^ENTRA_AUDIENCE=${audience.replace(/[/]/gu, "\\/")}$`,
    "m",
  );
  // The Lambda guards /api/live synthesis, the gateway guards the socket. A
  // student signing in has to satisfy both with the same token.
  assert.match(stagingGatewayEnv, expectsAudience);
  assert.match(stagingLambdaEnv, expectsAudience);
});

test("both staging backends actually turn their token checks on", () => {
  // ENTRA_AUDIENCE is inert on its own: liveAuth.js and buildConfiguredAuthenticator()
  // both return null — no guard at all — unless LIVE_AUTH_ENABLED is true. A
  // client that sends tokens to backends that ignore them is the failure this
  // catches, and it looks exactly like success from the browser.
  assert.match(stagingGatewayEnv, /^LIVE_AUTH_ENABLED=true$/m);
  assert.match(stagingLambdaEnv, /^LIVE_AUTH_ENABLED=true$/m);
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
