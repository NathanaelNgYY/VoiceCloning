import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOOK = join(
  dirname(fileURLToPath(import.meta.url)),
  "useGiChatEngine.js",
);

// `publishedVoiceProfileId` comes out of useDeployedChatbotPrompt as a `const`.
// Reading it above that declaration is not a stale value, it is a temporal dead
// zone: every render of the hook throws `Cannot access 'publishedVoiceProfileId'
// before initialization`, GiChatPanel throws with it, and since nothing in this
// tree is an error boundary the student gets a white lesson page. That shipped
// to lectures.lkcmedicine.org and blanked every lesson.
//
// Nothing in this suite renders React, so the throw cannot be observed here —
// what can be pinned is the ordering that causes it.

test("useGiChatEngine reads the published voice only after declaring it", () => {
  const source = readFileSync(HOOK, "utf-8");

  const BINDING = "voiceProfileId: publishedVoiceProfileId";
  const declaration = source.indexOf(BINDING);
  assert.notEqual(
    declaration,
    -1,
    "the published voice must still be destructured from useDeployedChatbotPrompt",
  );

  const firstUse = source.indexOf("publishedVoiceProfileId");
  assert.equal(
    firstUse,
    declaration + BINDING.indexOf("publishedVoiceProfileId"),
    "publishedVoiceProfileId is read before its const declaration — that is a TDZ throw, not a stale read",
  );
});
