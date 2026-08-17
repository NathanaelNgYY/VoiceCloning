import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const configSource = readFileSync(new URL("./config.js", import.meta.url), "utf8");
const giAppSource = readFileSync(new URL("./GiApp.jsx", import.meta.url), "utf8");
const appAuthGateSource = readFileSync(new URL("./auth/AppAuthGate.jsx", import.meta.url), "utf8");
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
const stagingFacultyEnv = readFileSync(
  new URL("../env/staging/chatbot-text.env", import.meta.url),
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
  // VITE_GI_AUTH_ENABLED alone still leaves config.js in "mock" auth mode, which
  // is a silent way for the gate to look enabled while accepting a localStorage
  // flag instead of an identity.
  assert.match(stagingGiEnv, /^VITE_AUTH_MODE=msal$/m);
  assert.match(
    stagingGiEnv,
    /^VITE_ENTRA_CLIENT_ID=9b5c52c0-5f02-4dbf-83ac-c68d246abc68$/m,
  );
  assert.match(
    stagingGiEnv,
    /^VITE_ENTRA_ALLOWED_EMAIL_DOMAINS=staff\.main\.ntu\.edu\.sg,student\.main\.ntu\.edu\.sg,assoc\.main\.ntu\.edu\.sg$/m,
  );
});

test("the client routes sign-in through /common, and only the backends pin a tenant", () => {
  // The app is registered in a directory that holds no NTU accounts, so pinning
  // the authority to it rejects every student with AADSTS50020. /common resolves
  // the signer's own tenant instead.
  //
  // That is only safe because the pin moved rather than disappeared: a build is
  // editable by whoever serves it, a token check is not. If these two ever
  // disagree — /common here with no tenant pinned there — the gate is gone and
  // every sign-in still looks perfectly normal from the browser.
  assert.match(
    stagingGiEnv,
    /^VITE_ENTRA_TENANT_AUTHORITY=https:\/\/login\.microsoftonline\.com\/common$/m,
  );

  const NTU_TENANT = "15ce9348-be2a-462b-8fc0-e1765a9b204a";
  const pinsNtuTenant = new RegExp(`^ENTRA_TENANT_ID=${NTU_TENANT}$`, "m");
  assert.match(stagingGatewayEnv, pinsNtuTenant);
  assert.match(stagingLambdaEnv, pinsNtuTenant);
});

test("the staging GI build sends a token to its own backends", () => {
  // Without this the browser signs in, the socket sends no session.auth, and the
  // gateway closes it — a build that looks authenticated and stores nothing.
  assert.match(stagingGiEnv, /^VITE_API_AUTH_MODE=entra-id$/m);
});

test("the token type the client sends is the one both backends verify", () => {
  // The two modes carry different `aud` values and entraToken.js rejects anything
  // that is not ENTRA_AUDIENCE exactly:
  //   entra-id  ->  <clientId>
  //   entra     ->  api://<clientId>
  // Client and backends are three files that deploy separately, so a mismatch
  // here surfaces as "sign-in is broken" rather than as a config error. The
  // Lambda guards /api/live synthesis, the gateway guards the socket, and one
  // token has to satisfy both.
  const CLIENT_ID = "9b5c52c0-5f02-4dbf-83ac-c68d246abc68";
  const mode = stagingGiEnv.match(/^VITE_API_AUTH_MODE=(.+)$/m)?.[1] ?? "";
  const expected = mode === "entra-id" ? CLIENT_ID : `api://${CLIENT_ID}`;

  const expectsAudience = new RegExp(
    `^ENTRA_AUDIENCE=${expected.replace(/[/]/gu, "\\/")}$`,
    "m",
  );
  assert.match(stagingGatewayEnv, expectsAudience);
  assert.match(stagingLambdaEnv, expectsAudience);

  // The access-token mode is the only one allowed to request a custom scope.
  // Setting it under entra-id appends it to the login request and fails sign-in
  // outright with AADSTS65005 — the scope is not exposed on the registration.
  if (mode === "entra-id") {
    assert.doesNotMatch(stagingGiEnv, /^VITE_ENTRA_API_SCOPE=.+$/m);
  } else {
    assert.match(
      stagingGiEnv,
      new RegExp(`^VITE_ENTRA_API_SCOPE=api:\\/\\/${CLIENT_ID}\\/.+$`, "m"),
    );
  }
});

test("both staging backends actually turn their token checks on", () => {
  // ENTRA_AUDIENCE is inert on its own: liveAuth.js and buildConfiguredAuthenticator()
  // both return null — no guard at all — unless LIVE_AUTH_ENABLED is true. A
  // client that sends tokens to backends that ignore them is the failure this
  // catches, and it looks exactly like success from the browser.
  assert.match(stagingGatewayEnv, /^LIVE_AUTH_ENABLED=true$/m);
  assert.match(stagingLambdaEnv, /^LIVE_AUTH_ENABLED=true$/m);
});

test("staging GI pins the saved Dean voice profile directly", () => {
  assert.match(stagingGiEnv, /^VITE_GI_VOICE_PROFILE_ID=deanvoice-v1$/m);
});

test("the faculty chatbot uses Microsoft SSO with only staff domains", () => {
  assert.match(stagingFacultyEnv, /^VITE_AUTH_ENABLED=true$/m);
  assert.match(stagingFacultyEnv, /^VITE_AUTH_MODE=msal$/m);
  assert.match(stagingFacultyEnv, /^VITE_API_AUTH_MODE=entra-id$/m);
  assert.match(
    stagingFacultyEnv,
    /^VITE_ENTRA_ALLOWED_EMAIL_DOMAINS=staff\.main\.ntu\.edu\.sg,assoc\.main\.ntu\.edu\.sg$/m,
  );
  assert.doesNotMatch(stagingFacultyEnv, /student\.main\.ntu\.edu\.sg/);
});

test("faculty has no backend auth exemption and uses a lecturer table", () => {
  assert.match(stagingGatewayEnv, /^LIVE_AUTH_EXEMPT_ORIGINS=$/m);
  assert.match(stagingLambdaEnv, /^LIVE_AUTH_EXEMPT_ORIGINS=$/m);
  assert.match(stagingGatewayEnv, /^LECTURER_TABLE_NAME=vcs-staging-lecturers$/m);
  for (const source of [stagingGatewayEnv, stagingLambdaEnv]) {
    assert.match(
      source,
      /^FACULTY_ENTRA_ALLOWED_EMAIL_DOMAINS=staff\.main\.ntu\.edu\.sg,assoc\.main\.ntu\.edu\.sg$/m,
    );
  }
});

test("public GI visitors bypass protected routes and cannot render the login page", () => {
  assert.match(
    appAuthGateSource,
    /if \(!config\.authEnabled\) return children;/,
  );
  assert.match(
    giAppSource,
    /path="\/login"[\s\S]*?config\.authEnabled[\s\S]*?<LoginPage \/>[\s\S]*?<Navigate to="\/" replace \/>/,
  );
});

test("a public build does not bootstrap Microsoft authentication", () => {
  assert.match(
    mainSource,
    /config\.authEnabled && isMsalAuthEnabled\(\)/,
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
