import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveReplyParams,
  createChatMessage,
  findFirstReplayablePart,
  findSelectedPlayback,
  findNextPhrasePlayback,
  findNextReplyPlayback,
  hasPendingReplyWork,
  getMicOffAction,
  createLiveSynthesisSnapshot,
  splitLiveReplyPhrases,
  shortenFirstFastPhrase,
  shouldTriggerLiveBargeIn,
  shouldSendLiveMicAudio,
  updateMessage,
  nextAudioErrorAction,
  isBenignRealtimeError,
  fixSpeechPronunciation,
  interClipGapMs,
  INTER_CLIP_GAP_MS,
  canReuseActiveUserMessage,
  resolvePendingTranscriptPatch,
  USER_TRANSCRIPT_TIMEOUT_MS,
  VOICE_GATE,
  createVoiceGateState,
  nextVoiceGateState,
  resolveSpeakingContinuation,
} from './liveConversation.js';

test('fixSpeechPronunciation rejoins the dragged GI initialism for speech', () => {
  assert.equal(fixSpeechPronunciation('G I bleeding means bleeding.'), 'gee eye bleeding means bleeding.');
  assert.equal(fixSpeechPronunciation('bleeding from the upper G I tract'), 'bleeding from the upper gee eye tract');
});

test('fixSpeechPronunciation leaves ordinary text unchanged', () => {
  assert.equal(fixSpeechPronunciation('The patient had melena and hematemesis.'), 'The patient had melena and hematemesis.');
  assert.equal(fixSpeechPronunciation(''), '');
});

test('isBenignRealtimeError swallows the active-response race', () => {
  assert.equal(
    isBenignRealtimeError('Conversation already has an active response in progress: resp_123. Wait until the response is finished before creating a new one.'),
    true,
  );
  assert.equal(isBenignRealtimeError('conversation_already_has_active_response'), true);
});

test('isBenignRealtimeError keeps real errors visible', () => {
  assert.equal(isBenignRealtimeError('OpenAI Realtime is not configured. Set OPENAI_API_KEY.'), false);
  assert.equal(isBenignRealtimeError('Live chat connection failed.'), false);
  assert.equal(isBenignRealtimeError(''), false);
  assert.equal(isBenignRealtimeError(undefined), false);
});

test('nextAudioErrorAction ignores errors with no source (teardown)', () => {
  const state = { src: '', retried: false };
  const result = nextAudioErrorAction(state, '');
  assert.equal(result.action, 'ignore');
});

test('nextAudioErrorAction retries a clip the first time it fails', () => {
  const result = nextAudioErrorAction({ src: '', retried: false }, 'blob:clip-1');
  assert.equal(result.action, 'retry');
  assert.deepEqual(result.retryState, { src: 'blob:clip-1', retried: true });
});

test('nextAudioErrorAction skips a clip that already failed its retry', () => {
  const result = nextAudioErrorAction({ src: 'blob:clip-1', retried: true }, 'blob:clip-1');
  assert.equal(result.action, 'skip');
});

test('nextAudioErrorAction gives each new clip its own retry budget', () => {
  // Previous clip exhausted its retry, but a new clip should still get one retry.
  const result = nextAudioErrorAction({ src: 'blob:clip-1', retried: true }, 'blob:clip-2');
  assert.equal(result.action, 'retry');
  assert.deepEqual(result.retryState, { src: 'blob:clip-2', retried: true });
});

test('createLiveSynthesisSnapshot freezes Live Full engine and config for a queued reply', () => {
  const fastRefParams = { ref_audio_path: 'fast-ref.wav' };
  const fullRefParams = { ref_audio_path: 'full-ref.wav', top_k: 5 };
  const snapshot = createLiveSynthesisSnapshot({
    engine: 'full',
    refParams: fastRefParams,
    fullRefParams,
    voiceProfileId: 'alexv1',
  });

  assert.deepEqual(snapshot, {
    engine: 'full',
    refParams: {
      ...fullRefParams,
      voiceProfileId: 'alexv1',
    },
  });
});

test('buildLiveReplyParams preserves full inference voice identity', () => {
  const params = buildLiveReplyParams('Hello.', {
    ref_audio_path: 'refs/sample.wav',
    voiceProfileId: 'alexv1',
  });

  assert.equal(params.voiceProfileId, 'alexv1');
});

test('shortenFirstFastPhrase splits a long first phrase at its first clause boundary', () => {
  const phrases = [
    'After the model finishes loading the weights, it starts generating audio right away.',
    'Second phrase here.',
  ];
  const result = shortenFirstFastPhrase(phrases);
  assert.equal(result.length, 3);
  // The head half is mid-sentence, so it ends with a continuation ellipsis —
  // a period would give it a falling, sentence-final read.
  assert.equal(result[0], 'After the model finishes loading the weights…');
  assert.equal(result[1], 'it starts generating audio right away.');
  assert.equal(result[2], 'Second phrase here.');
});

test('shortenFirstFastPhrase leaves a short first phrase untouched', () => {
  const phrases = ['Hello there, friend.', 'Next.'];
  assert.deepEqual(shortenFirstFastPhrase(phrases), phrases);
});

test('shortenFirstFastPhrase does not split when a half would be too short', () => {
  // First clause boundary leaves a tiny head, so the phrase stays intact rather
  // than producing a clipped-sounding fragment.
  const phrases = ['Yes, the inference server is fully warmed up and ready to synthesize now.'];
  assert.deepEqual(shortenFirstFastPhrase(phrases), phrases);
});

test('buildLiveReplyParams forces English assistant text for full inference', () => {
  const params = buildLiveReplyParams(' Hello there. ', {
    ref_audio_path: 'refs/sample.wav',
    prompt_text: 'reference words',
    prompt_lang: 'ja',
    aux_ref_audio_paths: ['refs/aux-a.wav', 'refs/aux-b.wav'],
  });

  assert.deepEqual(params, {
    text: 'Hello there.',
    text_lang: 'en',
    ref_audio_path: 'refs/sample.wav',
    prompt_text: 'reference words',
    prompt_lang: 'ja',
    aux_ref_audio_paths: ['refs/aux-a.wav', 'refs/aux-b.wav'],
  });
});

test('buildLiveReplyParams maps selected Chinese to GPT-SoVITS all-Chinese text mode', () => {
  const params = buildLiveReplyParams('Ni hao.', {
    ref_audio_path: 'refs/sample.wav',
  }, 'zh');

  assert.equal(params.text_lang, 'all_zh');
});

test('buildLiveReplyParams carries Live Fast inference controls without changing split logic', () => {
  const params = buildLiveReplyParams('Hello.', {
    ref_audio_path: 'refs/sample.wav',
    prompt_text: 'reference words',
    prompt_lang: 'en',
    aux_ref_audio_paths: ['refs/aux-a.wav'],
    top_k: 12,
    top_p: 0.75,
    temperature: 0.65,
    repetition_penalty: 1.2,
    speed_factor: 0.9,
  });

  assert.equal(params.top_k, 12);
  assert.equal(params.top_p, 0.75);
  assert.equal(params.temperature, 0.65);
  assert.equal(params.repetition_penalty, 1.2);
  assert.equal(params.speed_factor, 0.9);
  assert.deepEqual(splitLiveReplyPhrases('One. Two.'), ['One.', 'Two.']);
});

test('buildLiveReplyParams removes Latin words from selected Chinese TTS text', () => {
  const params = buildLiveReplyParams(
    '气温在thirty度左右，湿度在seventy%到eighty%，Singapore feels hot。',
    { ref_audio_path: 'refs/sample.wav' },
    'zh'
  );

  assert.equal(params.text, '气温在30度左右，湿度在70%到80%。');
  assert.doesNotMatch(params.text, /\p{Script=Latin}/u);
  assert.equal(params.text_lang, 'all_zh');
});

test('buildLiveReplyParams removes non-ASCII Latin letters from selected Chinese TTS text', () => {
  const params = buildLiveReplyParams(
    '今天AI café Ｓｉｎｇａｐｏｒｅ天气不错。',
    { ref_audio_path: 'refs/sample.wav' },
    'zh'
  );

  assert.equal(params.text, '今天天气不错。');
  assert.doesNotMatch(params.text, /\p{Script=Latin}/u);
});

test('chat messages keep stable ids and can be patched immutably', () => {
  const message = createChatMessage({
    id: 'msg-1',
    role: 'assistant',
    text: 'Draft',
    status: 'thinking',
    createdAt: 123,
  });

  assert.equal(message.id, 'msg-1');
  assert.equal(message.role, 'assistant');
  assert.equal(message.text, 'Draft');
  assert.equal(message.status, 'thinking');

  const next = updateMessage([message], 'msg-1', { text: 'Done', status: 'ready' });

  assert.notEqual(next[0], message);
  assert.equal(next[0].text, 'Done');
  assert.equal(next[0].status, 'ready');
});

test('splitLiveReplyPhrases splits punctuation for immediate voice playback', () => {
  assert.deepEqual(splitLiveReplyPhrases('Hello there! How are you? I am ready'), [
    'Hello there!',
    'How are you?',
    'I am ready.',
  ]);
});

test('splitLiveReplyPhrases does not split dotted initialisms into tiny clips', () => {
  assert.deepEqual(splitLiveReplyPhrases('The W.H.O guidance changed. Next sentence.'), [
    'The W.H.O guidance changed.',
    'Next sentence.',
  ]);
  assert.deepEqual(splitLiveReplyPhrases('Order an E.C.G. now'), [
    'Order an E.C.G. now.',
  ]);
});

test('splitLiveReplyPhrases breaks at em dashes so the voice pauses', () => {
  // The half before the dash ends with an ellipsis, not a period — a period makes
  // GPT-SoVITS read it with falling end-of-sentence intonation mid-thought, while
  // an ellipsis keeps a hanging "I'm not done yet" contour.
  assert.deepEqual(
    splitLiveReplyPhrases('a mix of cultures — Chinese, Malay, and more.'),
    ['a mix of cultures…', 'Chinese, Malay, and more.'],
  );
});

test('splitLiveReplyPhrases never turns a dash head into a question', () => {
  // "What I mean is —" starts with a question word but is mid-sentence; it must
  // get the continuation ellipsis, not a question mark's rising contour.
  assert.deepEqual(
    splitLiveReplyPhrases('What I mean is — listen closely.'),
    ['What I mean is…', 'listen closely.'],
  );
});

test('splitLiveReplyPhrases keeps existing punctuation on dash halves', () => {
  assert.deepEqual(
    splitLiveReplyPhrases('Is it fast? — Yes. Very fast.'),
    ['Is it fast?', 'Yes.', 'Very fast.'],
  );
});

test('splitLiveReplyPhrases does not double-punctuate an ellipsis ending', () => {
  assert.deepEqual(
    splitLiveReplyPhrases('Well, maybe… — hard to say.'),
    ['Well, maybe…', 'hard to say.'],
  );
});

test('splitLiveReplyPhrases splits Chinese punctuation for fast playback', () => {
  assert.deepEqual(splitLiveReplyPhrases('你好！我可以帮你。'), [
    '你好！',
    '我可以帮你。',
  ]);
});

test('findSelectedPlayback never falls back to previous audio', () => {
  const previous = createChatMessage({
    id: 'old',
    role: 'assistant',
    text: 'Old reply',
    audioUrl: 'blob:old',
  });
  const next = createChatMessage({
    id: 'new',
    role: 'assistant',
    text: 'New reply',
    status: 'generating_voice',
  });

  assert.equal(findSelectedPlayback([previous, next], 'new'), null);
  assert.equal(findSelectedPlayback([previous, next], 'old').audioUrl, 'blob:old');
});

test('findNextPhrasePlayback advances through every ready phrase clip in order', () => {
  const message = createChatMessage({
    id: 'reply-1',
    role: 'assistant',
    text: 'First. Second. Third.',
    audioParts: [
      { id: 'reply-1-part-1', index: 1, status: 'played', audioUrl: 'blob:first' },
      { id: 'reply-1-part-2', index: 2, status: 'ready', audioUrl: 'blob:second' },
      { id: 'reply-1-part-3', index: 3, status: 'ready', audioUrl: 'blob:third' },
    ],
  });

  const second = findNextPhrasePlayback([message], 'reply-1-part-1');
  assert.equal(second.part.id, 'reply-1-part-2');

  const third = findNextPhrasePlayback([message], 'reply-1-part-2');
  assert.equal(third.part.id, 'reply-1-part-3');

  assert.equal(findNextPhrasePlayback([message], 'reply-1-part-3'), null);
});

test('findNextPhrasePlayback can replay phrase clips that were already played', () => {
  const message = createChatMessage({
    id: 'reply-replay',
    role: 'assistant',
    audioParts: [
      { id: 'reply-replay-part-1', index: 1, status: 'played', audioUrl: 'blob:first' },
      { id: 'reply-replay-part-2', index: 2, status: 'played', audioUrl: 'blob:second' },
    ],
  });

  const second = findNextPhrasePlayback([message], 'reply-replay-part-1');
  assert.equal(second.part.id, 'reply-replay-part-2');
});

test('findNextReplyPlayback chains a split reply into the next message\'s unplayed clip', () => {
  const first = createChatMessage({
    id: 'reply-a',
    role: 'assistant',
    status: 'ready',
    audioParts: [
      { id: 'reply-a-part-1', index: 1, status: 'played', audioUrl: 'blob:a1' },
    ],
  });
  const second = createChatMessage({
    id: 'reply-b',
    role: 'assistant',
    status: 'generating_voice',
    audioParts: [
      { id: 'reply-b-part-1', index: 1, status: 'ready', audioUrl: 'blob:b1' },
      { id: 'reply-b-part-2', index: 2, status: 'generating', audioUrl: null },
    ],
  });

  const next = findNextReplyPlayback([first, second], 'reply-a');
  assert.equal(next.message.id, 'reply-b');
  assert.equal(next.part.id, 'reply-b-part-1');
  assert.equal(next.audioUrl, 'blob:b1');
});

test('findNextReplyPlayback does not cascade a replay into already-read messages', () => {
  const first = createChatMessage({
    id: 'reply-a',
    role: 'assistant',
    status: 'ready',
    audioParts: [
      { id: 'reply-a-part-1', index: 1, status: 'played', audioUrl: 'blob:a1' },
    ],
  });
  const second = createChatMessage({
    id: 'reply-b',
    role: 'assistant',
    status: 'ready',
    audioParts: [
      { id: 'reply-b-part-1', index: 1, status: 'played', audioUrl: 'blob:b1' },
    ],
  });

  assert.equal(findNextReplyPlayback([first, second], 'reply-a'), null);
});

test('findNextReplyPlayback only looks at assistant messages after the finished one', () => {
  const earlier = createChatMessage({
    id: 'reply-early',
    role: 'assistant',
    status: 'ready',
    audioParts: [
      { id: 'reply-early-part-1', index: 1, status: 'ready', audioUrl: 'blob:early' },
    ],
  });
  const user = createChatMessage({ id: 'user-1', role: 'user', text: 'Hi.' });
  const finished = createChatMessage({
    id: 'reply-a',
    role: 'assistant',
    status: 'ready',
    audioParts: [
      { id: 'reply-a-part-1', index: 1, status: 'played', audioUrl: 'blob:a1' },
    ],
  });

  assert.equal(findNextReplyPlayback([earlier, user, finished], 'reply-a'), null);
  assert.equal(findNextReplyPlayback([earlier, user, finished], 'missing-id'), null);
});

test('hasPendingReplyWork reflects replies still generating voice', () => {
  const generating = createChatMessage({ id: 'reply-b', role: 'assistant', status: 'generating_voice' });
  const done = createChatMessage({ id: 'reply-a', role: 'assistant', status: 'ready' });
  const errored = createChatMessage({ id: 'reply-c', role: 'assistant', status: 'error' });
  const interrupted = createChatMessage({ id: 'reply-d', role: 'assistant', status: 'interrupted' });
  const userThinking = createChatMessage({ id: 'user-2', role: 'user', status: 'generating_voice' });

  assert.equal(hasPendingReplyWork([done, generating]), true);
  assert.equal(hasPendingReplyWork([done, errored, interrupted, userThinking]), false);
  assert.equal(hasPendingReplyWork([]), false);
});

test('shouldSendLiveMicAudio only allows enabled mic input during listening phases', () => {
  assert.equal(shouldSendLiveMicAudio({ phase: 'listening', micInputEnabled: true }), true);
  assert.equal(shouldSendLiveMicAudio({ phase: 'thinking', micInputEnabled: true }), true);
  assert.equal(shouldSendLiveMicAudio({ phase: 'speaking', micInputEnabled: true }), false);
  assert.equal(shouldSendLiveMicAudio({ phase: 'listening', micInputEnabled: false }), false);
});

test('getMicOffAction commits active speech without pausing an in-flight response', () => {
  assert.equal(getMicOffAction({ phase: 'listening', hasPendingAudio: true }), 'commit');
  assert.equal(getMicOffAction({ phase: 'listening', hasPendingAudio: false }), 'pause');
  assert.equal(getMicOffAction({ phase: 'thinking', hasPendingAudio: true }), 'wait');
  assert.equal(getMicOffAction({ phase: 'speaking', hasPendingAudio: true }), 'pause');
});

test('findFirstReplayablePart allows replaying clips that were already played', () => {
  const message = createChatMessage({
    id: 'reply-2',
    role: 'assistant',
    audioParts: [
      { id: 'reply-2-part-1', index: 1, status: 'played', audioUrl: 'blob:first' },
      { id: 'reply-2-part-2', index: 2, status: 'ready', audioUrl: 'blob:second' },
    ],
  });

  assert.equal(findFirstReplayablePart(message).id, 'reply-2-part-1');
});

test('shouldTriggerLiveBargeIn only reacts to deliberate speech during cloned playback', () => {
  assert.equal(shouldTriggerLiveBargeIn({
    phase: 'speaking',
    micInputEnabled: true,
    rms: 0.06,
  }), true);
  assert.equal(shouldTriggerLiveBargeIn({
    phase: 'speaking',
    micInputEnabled: true,
    rms: 0.01,
  }), false);
  assert.equal(shouldTriggerLiveBargeIn({
    phase: 'listening',
    micInputEnabled: true,
    rms: 0.06,
  }), false);
  assert.equal(shouldTriggerLiveBargeIn({
    phase: 'speaking',
    micInputEnabled: false,
    rms: 0.06,
  }), false);
});

test('canReuseActiveUserMessage allows bubbles still collecting a turn', () => {
  assert.equal(canReuseActiveUserMessage(createChatMessage({
    id: 'u1', role: 'user', text: 'Listening...', status: 'listening',
  })), true);
  assert.equal(canReuseActiveUserMessage(createChatMessage({
    id: 'u1', role: 'user', text: 'Transcribing...', status: 'transcribing',
  })), true);
});

test('canReuseActiveUserMessage refuses finished or missing bubbles', () => {
  assert.equal(canReuseActiveUserMessage(createChatMessage({
    id: 'u1', role: 'user', text: 'What is melena?', status: 'done',
  })), false);
  assert.equal(canReuseActiveUserMessage(null), false);
  assert.equal(canReuseActiveUserMessage(undefined), false);
});

test('resolvePendingTranscriptPatch closes a stuck Transcribing bubble with the fallback label', () => {
  const patch = resolvePendingTranscriptPatch(createChatMessage({
    id: 'u1', role: 'user', text: 'Transcribing...', status: 'transcribing',
  }));
  assert.deepEqual(patch, { text: 'Voice message sent.', status: 'done' });
});

test('resolvePendingTranscriptPatch keeps partial words already streamed', () => {
  const patch = resolvePendingTranscriptPatch(createChatMessage({
    id: 'u1', role: 'user', text: 'What is mel', status: 'transcribing',
  }));
  assert.deepEqual(patch, { text: 'What is mel', status: 'done' });
});

test('resolvePendingTranscriptPatch leaves other bubbles alone', () => {
  assert.equal(resolvePendingTranscriptPatch(createChatMessage({
    id: 'u1', role: 'user', text: 'Listening...', status: 'listening',
  })), null);
  assert.equal(resolvePendingTranscriptPatch(createChatMessage({
    id: 'u1', role: 'user', text: 'What is melena?', status: 'done',
  })), null);
  assert.equal(resolvePendingTranscriptPatch(createChatMessage({
    id: 'a1', role: 'assistant', text: 'Transcribing...', status: 'transcribing',
  })), null);
  assert.equal(resolvePendingTranscriptPatch(null), null);
});

test('user transcript timeout is long enough for slow transcripts but finite', () => {
  assert.equal(typeof USER_TRANSCRIPT_TIMEOUT_MS, 'number');
  assert.ok(USER_TRANSCRIPT_TIMEOUT_MS >= 5000);
  assert.ok(USER_TRANSCRIPT_TIMEOUT_MS <= 30000);
});

test('voice gate stays closed for sub-threshold noise', () => {
  let state = createVoiceGateState();
  for (let i = 0; i < 20; i += 1) {
    state = nextVoiceGateState(state, VOICE_GATE.threshold * 0.5);
    assert.equal(state.open, false);
  }
});

test('voice gate opens after sustained voice and flags the opening frame once', () => {
  let state = createVoiceGateState();
  state = nextVoiceGateState(state, VOICE_GATE.threshold * 2);
  assert.equal(state.open, false);
  state = nextVoiceGateState(state, VOICE_GATE.threshold * 2);
  assert.equal(state.open, true);
  assert.equal(state.justOpened, true);
  state = nextVoiceGateState(state, VOICE_GATE.threshold * 2);
  assert.equal(state.open, true);
  assert.equal(state.justOpened, false);
});

test('voice gate rides through short pauses but closes after the hangover', () => {
  let state = createVoiceGateState();
  state = nextVoiceGateState(state, VOICE_GATE.threshold * 2);
  state = nextVoiceGateState(state, VOICE_GATE.threshold * 2);
  assert.equal(state.open, true);

  for (let i = 0; i < VOICE_GATE.hangoverFrames - 1; i += 1) {
    state = nextVoiceGateState(state, 0);
    assert.equal(state.open, true);
  }
  state = nextVoiceGateState(state, 0);
  assert.equal(state.open, false);
});

test('voice gate resets its opening streak on a quiet frame', () => {
  let state = createVoiceGateState();
  state = nextVoiceGateState(state, VOICE_GATE.threshold * 2);
  state = nextVoiceGateState(state, 0);
  state = nextVoiceGateState(state, VOICE_GATE.threshold * 2);
  assert.equal(state.open, false);
});

test('getMicOffAction discards a pending turn with no voice evidence', () => {
  assert.equal(
    getMicOffAction({ phase: 'listening', hasPendingAudio: true, hasVoiceEvidence: false }),
    'discard',
  );
  assert.equal(
    getMicOffAction({ phase: 'listening', hasPendingAudio: true, hasVoiceEvidence: true }),
    'commit',
  );
  // Callers that don't track voice evidence keep the old commit behavior.
  assert.equal(
    getMicOffAction({ phase: 'listening', hasPendingAudio: true }),
    'commit',
  );
});

// ── resolveSpeakingContinuation ──────────────────────────────────────────────
// Regression suite for the live-fast handoff races: clips ending while React
// state is mid-flight used to strand ready clips (skipped sentences) or park
// the conversation in a silent 'speaking' phase (reply cut off mid-text).

function makeReply(id, { status = 'generating_voice', voiceStopped = false, parts = [] } = {}) {
  return createChatMessage({
    id,
    role: 'assistant',
    status,
    voiceStopped,
    audioParts: parts.map((part, index) => ({
      id: `${id}-part-${index + 1}`,
      index: index + 1,
      audioUrl: part.status === 'queued' || part.status === 'generating' ? null : `blob:${id}-${index + 1}`,
      ...part,
    })),
  });
}

test('resolveSpeakingContinuation plays the earliest unplayed ready clip, not a later one', () => {
  // Skip regression: part 2 became ready during a stale-ref window; part 3
  // finished afterwards. The earliest unplayed clip must win or part 2 is
  // silently skipped.
  const messages = [
    makeReply('reply-1', {
      parts: [
        { status: 'played' },
        { status: 'ready' },
        { status: 'ready' },
        { status: 'generating' },
      ],
    }),
  ];
  const decision = resolveSpeakingContinuation(messages, { synthesisMessageId: 'reply-1' });
  assert.equal(decision.action, 'play');
  assert.equal(decision.part.id, 'reply-1-part-2');
});

test('resolveSpeakingContinuation plays a stranded final clip after synthesis already finished', () => {
  // Stall regression: the loop finished (no synthesis id) but the last clip
  // was never selected because the ended event raced the state flush.
  const messages = [
    makeReply('reply-1', {
      status: 'ready',
      parts: [{ status: 'played' }, { status: 'played' }, { status: 'ready' }],
    }),
  ];
  const decision = resolveSpeakingContinuation(messages, { synthesisMessageId: '' });
  assert.equal(decision.action, 'play');
  assert.equal(decision.part.id, 'reply-1-part-3');
});

test('resolveSpeakingContinuation waits while clips are still being generated', () => {
  const messages = [
    makeReply('reply-1', {
      parts: [{ status: 'played' }, { status: 'generating' }],
    }),
  ];
  const decision = resolveSpeakingContinuation(messages, { synthesisMessageId: 'reply-1' });
  assert.equal(decision.action, 'wait');
});

test('resolveSpeakingContinuation settles when nothing is ready or pending', () => {
  const messages = [
    makeReply('reply-1', {
      status: 'ready',
      parts: [{ status: 'played' }, { status: 'played' }],
    }),
  ];
  const decision = resolveSpeakingContinuation(messages, { synthesisMessageId: '' });
  assert.equal(decision.action, 'settle');
});

test('resolveSpeakingContinuation never auto-plays a voice-stopped reply', () => {
  // Stop voice keeps generating clips in the background; they must stay
  // silent until the user presses Play voice.
  const messages = [
    makeReply('reply-1', {
      voiceStopped: true,
      parts: [{ status: 'played' }, { status: 'ready' }, { status: 'generating' }],
    }),
  ];
  const decision = resolveSpeakingContinuation(messages, { synthesisMessageId: 'reply-1' });
  assert.equal(decision.action, 'settle');
});

test('resolveSpeakingContinuation skips interrupted and errored replies', () => {
  const messages = [
    makeReply('reply-1', {
      status: 'interrupted',
      parts: [{ status: 'ready' }],
    }),
    makeReply('reply-2', {
      status: 'error',
      parts: [{ status: 'ready' }],
    }),
  ];
  const decision = resolveSpeakingContinuation(messages, { synthesisMessageId: '' });
  assert.equal(decision.action, 'settle');
});

test('resolveSpeakingContinuation waits on a split reply still synthesizing in a later message', () => {
  const messages = [
    makeReply('reply-1', {
      status: 'ready',
      parts: [{ status: 'played' }],
    }),
    makeReply('reply-2', { parts: [{ status: 'generating' }] }),
  ];
  const decision = resolveSpeakingContinuation(messages, { synthesisMessageId: 'reply-2' });
  assert.equal(decision.action, 'wait');
});

// ── interClipGapMs ───────────────────────────────────────────────────────────
// Punctuation-aware pause between reply clips: a sentence end gets a longer
// breath than a mid-sentence continuation (dash/ellipsis/clause split). The gap
// is inserted between an ended clip and the next ready one, so it never delays
// the first clip of a reply.

test('interClipGapMs gives a full breath after a finished sentence', () => {
  assert.equal(interClipGapMs('That is the whole story.'), INTER_CLIP_GAP_MS.sentence);
  assert.equal(interClipGapMs('Really?'), INTER_CLIP_GAP_MS.sentence);
  assert.equal(interClipGapMs('Amazing!'), INTER_CLIP_GAP_MS.sentence);
  assert.equal(interClipGapMs('我可以帮你。'), INTER_CLIP_GAP_MS.sentence);
});

test('interClipGapMs gives a short pause after a mid-sentence continuation', () => {
  assert.equal(interClipGapMs('a mix of cultures…'), INTER_CLIP_GAP_MS.continuation);
  assert.equal(interClipGapMs('here is the thing;'), INTER_CLIP_GAP_MS.continuation);
  assert.equal(interClipGapMs('two options:'), INTER_CLIP_GAP_MS.continuation);
});

test('interClipGapMs returns no gap for missing clip text', () => {
  assert.equal(interClipGapMs(''), 0);
  assert.equal(interClipGapMs(null), 0);
  assert.equal(interClipGapMs(undefined), 0);
});

test('inter-clip gaps stay short enough to feel live', () => {
  assert.ok(INTER_CLIP_GAP_MS.continuation > 0);
  assert.ok(INTER_CLIP_GAP_MS.continuation < INTER_CLIP_GAP_MS.sentence);
  assert.ok(INTER_CLIP_GAP_MS.sentence <= 600);
});

test('hasPendingReplyWork ignores voice-stopped background generation', () => {
  const messages = [
    makeReply('reply-1', { voiceStopped: true, parts: [{ status: 'generating' }] }),
  ];
  assert.equal(hasPendingReplyWork(messages), false);
  const foreground = [makeReply('reply-2', { parts: [{ status: 'generating' }] })];
  assert.equal(hasPendingReplyWork(foreground), true);
});
