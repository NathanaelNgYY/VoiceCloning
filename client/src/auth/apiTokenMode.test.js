import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCESS_TOKEN,
  ID_TOKEN,
  NO_TOKEN,
  loginApiScope,
  resolveApiTokenMode,
} from "./apiTokenMode.js";

const SCOPE = "api://9b5c52c0-5f02-4dbf-83ac-c68d246abc68/access_as_user";

test("the ID-token mode needs nothing but the mode itself", () => {
  // The whole point of this route: no exposed scope, so no portal work.
  assert.equal(
    resolveApiTokenMode({
      msalEnabled: true,
      apiAuthMode: "entra-id",
      entraApiScope: "",
    }),
    ID_TOKEN,
  );
});

test("the access-token mode needs a scope to ask for", () => {
  const inputs = { msalEnabled: true, apiAuthMode: "entra", entraApiScope: SCOPE };
  assert.equal(resolveApiTokenMode(inputs), ACCESS_TOKEN);

  // Half-configured is treated as off, not as an access-token build:
  // acquireTokenSilent would have no scope to request.
  assert.equal(resolveApiTokenMode({ ...inputs, entraApiScope: "" }), NO_TOKEN);
});

test("mock auth sends no token however the other two are set", () => {
  // Otherwise a dev build with the localStorage gate would attach a token it
  // cannot obtain, and every API call would throw instead of staying anonymous.
  for (const apiAuthMode of ["entra", "entra-id", "none"]) {
    assert.equal(
      resolveApiTokenMode({ msalEnabled: false, apiAuthMode, entraApiScope: SCOPE }),
      NO_TOKEN,
      `${apiAuthMode} should send nothing while msal is disabled`,
    );
  }
});

test("an unrecognised mode sends no token rather than guessing", () => {
  assert.equal(
    resolveApiTokenMode({
      msalEnabled: true,
      apiAuthMode: "entra-access",
      entraApiScope: SCOPE,
    }),
    NO_TOKEN,
  );
});

test("only the access-token mode widens the login request", () => {
  // A scope left set under entra-id fails the *sign-in* with AADSTS65005 —
  // MSAL appends it to the login, not just to the later API call — so the
  // symptom is "SSO is broken", nowhere near the setting that caused it.
  assert.equal(
    loginApiScope({ msalEnabled: true, apiAuthMode: "entra-id", entraApiScope: SCOPE }),
    "",
  );
  assert.equal(
    loginApiScope({ msalEnabled: true, apiAuthMode: "entra", entraApiScope: SCOPE }),
    SCOPE,
  );
  assert.equal(
    loginApiScope({ msalEnabled: false, apiAuthMode: "entra", entraApiScope: SCOPE }),
    "",
  );
});
