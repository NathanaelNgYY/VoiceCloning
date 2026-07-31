import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const searchPageSource = readFileSync(new URL("./SearchPage.jsx", import.meta.url), "utf8");
const lessonPageSource = readFileSync(new URL("./LessonPage.jsx", import.meta.url), "utf8");
const giChatPageSource = readFileSync(new URL("./GiChatPage.jsx", import.meta.url), "utf8");
const giChatPanelSource = readFileSync(
  new URL("../components/gi/GiChatPanel.jsx", import.meta.url),
  "utf8",
);
const composerSource = readFileSync(
  new URL("../components/gi/Composer.jsx", import.meta.url),
  "utf8",
);

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
  // The panel is bounded by the shell rather than by a fixed height: it fills
  // what the video leaves and scrolls inside itself.
  assert.match(
    lessonPageSource,
    /"min-h-0 flex-1 flex-col overflow-hidden rounded-2xl[^"]*"/,
  );
  assert.match(
    lessonPageSource,
    /"[^"]*overscroll-contain[^"]*overflow-y-auto[^"]*"/,
  );
});

test("the lesson fits the viewport instead of scrolling as a page", () => {
  assert.match(lessonPageSource, /className="relative flex h-\[100dvh\][^"]*overflow-hidden/);
  assert.match(lessonPageSource, /<main className="[^"]*min-h-0[^"]*overflow-hidden/);
  // No trailing dead space to scroll past to reach the panel.
  assert.doesNotMatch(lessonPageSource, /className="h-48 shrink-0 sm:h-64"/);
});

test("the lesson video is capped in viewport height so the panel keeps its share", () => {
  assert.match(lessonPageSource, /aspect-video[^"]*max-w-\[calc\(36dvh\*16\/9\)\]/);
});

test("video and study panel sit side by side on desktop", () => {
  assert.match(lessonPageSource, /className="mx-auto flex w-full min-h-0[^"]*lg:flex-row/);
  assert.match(lessonPageSource, /lg:w-\[27rem\][^"]*lg:flex-none/);
});

test("desktop shows transcript under the video and the chatbot beside it", () => {
  // The tab pair is a phone-only fallback for a screen too narrow for both.
  assert.match(lessonPageSource, /<div className="flex shrink-0 lg:hidden">/);
  // Both panels render at lg regardless of which tab the phone layout selected.
  const desktopVisible = lessonPageSource.match(/"[^"]*lg:flex[^"]*",\s*\n\s*activeTab === "(transcript|chatbot)" \? "flex" : "hidden"/g);
  assert.equal(desktopVisible?.length, 2);
});

test("both gi chat surfaces offer typing alongside the mic", () => {
  // Someone on a machine with no microphone must be able to ask a question,
  // so the text input is wired on the standalone kiosk and the lesson panel.
  assert.match(giChatPageSource, /onSendText=\{chat\.sendText\}/);
  assert.match(giChatPanelSource, /onSendText=\{chat\.sendText\}/);
});

test("the composer's voice chip stays clear of the text input row", () => {
  // The composer row is a full-width text field, so the chip can no longer be
  // pinned out of flow beside it — it owns a line above instead.
  assert.match(giChatPanelSource, /<div className="mb-2 flex justify-center">\s*\n\s*<VoiceIndicator/);
  assert.doesNotMatch(giChatPanelSource, /<div className="absolute left-3[^"]*">\s*\n\s*<VoiceIndicator/);
});

test("the gi composer keeps Stop voice and End alongside the typing row", () => {
  // Typing must not cost the session controls: the mic mutes, and ending stays
  // a separate deliberate tap.
  assert.match(composerSource, /onClick=\{onStopVoice\}/);
  assert.match(composerSource, /onClick=\{onStop\}/);
  assert.match(composerSource, /onClick=\{active \? onToggleMute : onStart\}/);
});
