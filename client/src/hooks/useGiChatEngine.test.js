import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-shape assertions, matching the convention in giPublicAccess.test.js and
// giResponsiveLayout.test.js: nothing in this client suite renders React, so a
// hook's behaviour cannot be exercised directly here.
const engineSource = readFileSync(
  new URL("./useGiChatEngine.js", import.meta.url),
  "utf8",
);

test("configured GI voice is sent by id without a startup profile request", () => {
  assert.doesNotMatch(engineSource, /getPinnedVoiceProfile/);
  assert.match(
    engineSource,
    /if \(!backendQueryable \|\| pinnedVoiceProfileId\) return;/,
  );
  assert.match(
    engineSource,
    /voiceProfileId: pinnedVoiceProfileId \|\| activeProfile\?\.voiceProfileId \|\| ''/,
  );
  assert.match(engineSource, /if \(pinnedVoiceProfileId\) return \{\};/);
});
