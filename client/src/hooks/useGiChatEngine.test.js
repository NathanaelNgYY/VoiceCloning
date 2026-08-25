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

test("New chat ends the realtime session, not just the visible transcript", () => {
  // The Realtime conversation is server-side state that outlives the bubbles.
  // The socket stays open across turns for the whole session, so clearing only
  // the transcript leaves every hidden message in context for the next reply —
  // a "new" chat that inherits the old one's drift. This is the difference
  // between hiding the evidence and starting over.
  const newChatBody = engineSource.match(
    /const newChat = useCallback\(\(\) => \{([\s\S]*?)\}, \[/,
  )?.[1];

  assert.ok(newChatBody, "newChat should be a useCallback with a readable body");
  assert.match(newChatBody, /setClearedBeforeId\(/);
  assert.match(newChatBody, /liveSpeech\.stop\(\)/);
});

test("visible transcript falls back to the whole list once ids stop matching", () => {
  // start() empties useLiveSpeech's messages, so the stored cutoff id matches
  // nothing on the next session. findIndex returning -1 has to mean "show
  // everything", or the first fresh reply would be hidden by a stale marker.
  assert.match(
    engineSource,
    /cutoff === -1 \? liveSpeech\.messages : liveSpeech\.messages\.slice\(cutoff \+ 1\)/,
  );
});

test("configured GI voice is sent by id without a startup profile request", () => {
  assert.doesNotMatch(engineSource, /getPinnedVoiceProfile/);
  assert.match(
    engineSource,
    /if \(!backendQueryable \|\| requestedVoiceProfileId\) return;/,
  );
  assert.match(
    engineSource,
    /voiceProfileId: requestedVoiceProfileId \|\| activeProfile\?\.voiceProfileId \|\| ''/,
  );
  assert.match(engineSource, /if \(requestedVoiceProfileId\) return \{\};/);
});

test("lecture voice capacity is checked before conversation controls unlock", () => {
  assert.match(engineSource, /prepareVoiceCapacity\(requestedVoiceProfileId\)/);
  assert.match(engineSource, /voiceCapacityBlocksConversation\(voiceCapacity\)/);
  assert.match(engineSource, /voiceReady = refParams !== null && !voiceMismatch && !capacityBlocksConversation/);
});
