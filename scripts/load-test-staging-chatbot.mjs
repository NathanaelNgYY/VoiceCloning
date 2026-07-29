import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const requireFromGateway = createRequire(
  new URL('../live-gateway/package.json', import.meta.url),
);
const WebSocket = requireFromGateway('ws');

const concurrency = Number.parseInt(process.argv[2] || '1', 10);
const wsUrl = process.env.VCS_CHATBOT_WS_URL
  || 'wss://d25sg72wp8oj5g.cloudfront.net/api/live/chat/realtime?language=en';
const ttsUrl = process.env.VCS_CHATBOT_TTS_URL
  || 'https://d25sg72wp8oj5g.cloudfront.net/api/live/tts-sentence';
const origin = process.env.VCS_CHATBOT_ORIGIN
  || 'https://d25sg72wp8oj5g.cloudfront.net';
const audioPath = process.env.VCS_CHATBOT_AUDIO_WAV
  || new URL('../.tmp/chatbot-load-question.wav', import.meta.url);
const timeoutMs = Number.parseInt(process.env.VCS_CHATBOT_TIMEOUT_MS || '180000', 10);
const audioFrameMs = Number.parseInt(process.env.VCS_CHATBOT_AUDIO_FRAME_MS || '100', 10);
const turnCount = Number.parseInt(process.env.VCS_CHATBOT_TURNS || '1', 10);
const thinkTimeMs = Number.parseInt(process.env.VCS_CHATBOT_THINK_MS || '250', 10);
const paceAudio = process.env.VCS_CHATBOT_PACE_AUDIO !== 'false';
const manualCommit = process.env.VCS_CHATBOT_MANUAL_COMMIT === 'true';
const voiceProfileId = process.env.VCS_CHATBOT_VOICE_PROFILE_ID || 'deanvoice-v1';
const reportFile = process.env.VCS_CHATBOT_REPORT_FILE || '';

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200) {
  throw new Error('Concurrency must be an integer from 1 to 200.');
}
if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 600_000) {
  throw new Error('VCS_CHATBOT_TIMEOUT_MS must be from 10000 to 600000.');
}
if (!Number.isInteger(audioFrameMs) || audioFrameMs < 20 || audioFrameMs > 1000) {
  throw new Error('VCS_CHATBOT_AUDIO_FRAME_MS must be from 20 to 1000.');
}
if (!Number.isInteger(turnCount) || turnCount < 1 || turnCount > 10) {
  throw new Error('VCS_CHATBOT_TURNS must be from 1 to 10.');
}
if (!Number.isInteger(thinkTimeMs) || thinkTimeMs < 0 || thinkTimeMs > 60_000) {
  throw new Error('VCS_CHATBOT_THINK_MS must be from 0 to 60000.');
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    min: sorted.length ? Math.round(sorted[0]) : null,
    p50: percentile(sorted, 0.50) == null ? null : Math.round(percentile(sorted, 0.50)),
    p95: percentile(sorted, 0.95) == null ? null : Math.round(percentile(sorted, 0.95)),
    p99: percentile(sorted, 0.99) == null ? null : Math.round(percentile(sorted, 0.99)),
    max: sorted.length ? Math.round(sorted.at(-1)) : null,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function ensureLoadTestAudio(pathOrUrl) {
  const path = pathOrUrl instanceof URL ? fileURLToPath(pathOrUrl) : pathOrUrl;
  if (existsSync(path)) return;
  if (process.platform !== 'win32') {
    throw new Error(
      `Load-test audio does not exist at ${path}. Set VCS_CHATBOT_AUDIO_WAV to `
      + 'a PCM 24000 Hz 16-bit mono WAV containing a spoken question.',
    );
  }

  mkdirSync(dirname(path), { recursive: true });
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        'Add-Type -AssemblyName System.Speech',
        '$format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(',
        '  24000,',
        '  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,',
        '  [System.Speech.AudioFormat.AudioChannel]::Mono',
        ')',
        '$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()',
        'try {',
        '  $synth.SetOutputToWaveFile($env:VCS_CHATBOT_GENERATED_WAV, $format)',
        "  $synth.Speak('What is gastrointestinal bleeding?')",
        '} finally {',
        '  $synth.Dispose()',
        '}',
      ].join('\n'),
    ],
    { env: { ...process.env, VCS_CHATBOT_GENERATED_WAV: path } },
  );
}

function readPcmWav(pathOrUrl) {
  const wav = readFileSync(pathOrUrl);
  if (wav.subarray(0, 4).toString('ascii') !== 'RIFF'
    || wav.subarray(8, 12).toString('ascii') !== 'WAVE') {
    throw new Error('Load-test audio must be a RIFF/WAVE file.');
  }

  let format = null;
  let pcm = null;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.subarray(offset, offset + 4).toString('ascii');
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > wav.length) break;
    if (id === 'fmt ') {
      format = {
        audioFormat: wav.readUInt16LE(start),
        channels: wav.readUInt16LE(start + 2),
        sampleRate: wav.readUInt32LE(start + 4),
        blockAlign: wav.readUInt16LE(start + 12),
        bitsPerSample: wav.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      pcm = wav.subarray(start, end);
    }
    offset = end + (size % 2);
  }

  if (!format || !pcm) throw new Error('Load-test WAV is missing fmt or data.');
  if (format.audioFormat !== 1
    || format.channels !== 1
    || format.sampleRate !== 24_000
    || format.bitsPerSample !== 16) {
    throw new Error(
      `Expected PCM 24000 Hz 16-bit mono; received format=${format.audioFormat}, `
      + `channels=${format.channels}, rate=${format.sampleRate}, bits=${format.bitsPerSample}.`,
    );
  }
  return { ...format, pcm };
}

function loadProductionSystemPrompt() {
  if (process.env.VCS_CHATBOT_SYSTEM_PROMPT_FILE) {
    return readFileSync(process.env.VCS_CHATBOT_SYSTEM_PROMPT_FILE, 'utf8').trim();
  }
  const source = execFileSync(
    'git',
    ['show', 'staging-chatbot:client/src/lib/chatbotSystemPrompt.js'],
    { encoding: 'utf8' },
  );
  const match = source.match(/DEFAULT_CHATBOT_SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`;/u);
  if (!match) throw new Error('Could not extract the staging chatbot system prompt.');
  return match[1].trim();
}

function markerFor(index) {
  return `Load test user ${String(index + 1).padStart(3, '0')}`;
}

const SMALL_NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS_NUMBER_WORDS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

function numberWords(value) {
  if (value < 20) return SMALL_NUMBER_WORDS[value];
  if (value < 100) {
    return `${TENS_NUMBER_WORDS[Math.floor(value / 10)]} ${SMALL_NUMBER_WORDS[value % 10]}`
      .replace(/\s+zero$/u, '');
  }
  if (value < 200) {
    return `one hundred ${numberWords(value - 100)}`.replace(/\s+zero$/u, '');
  }
  return String(value);
}

function containsUserMarker(text, userNumber) {
  const words = numberWords(userNumber).replace(/\s+/gu, '\\s+');
  return new RegExp(
    `\\bload\\s+test\\s+user\\s+(?:0*${userNumber}|${words})\\b`,
    'iu',
  ).test(text);
}

function splitResponseChunks(text, maxChunkLength = 280) {
  const sentences = String(text || '')
    .replace(/\s+/gu, ' ')
    .trim()
    .match(/[^.!?]+[.!?]+|[^.!?]+$/gu) || [];
  const chunks = [];
  for (const rawSentence of sentences) {
    let sentence = rawSentence.trim();
    while (sentence.length > maxChunkLength) {
      let cut = sentence.lastIndexOf(' ', maxChunkLength);
      if (cut < Math.floor(maxChunkLength * 0.6)) cut = maxChunkLength;
      chunks.push(sentence.slice(0, cut).trim());
      sentence = sentence.slice(cut).trim();
    }
    if (sentence) chunks.push(sentence);
  }
  return chunks;
}

function makeSession(index, audio, productionPrompt) {
  const marker = markerFor(index);
  const createdAt = performance.now();
  const ready = deferred();
  const result = deferred();
  let settled = false;
  let started = false;
  let turnIndex = -1;
  let connectedAt = null;
  let readyAt = null;
  let currentTurn = null;
  const completedTurns = [];

  const socket = new WebSocket(wsUrl, {
    headers: { Origin: origin },
    handshakeTimeout: Math.min(timeoutMs, 30_000),
  });

  const finish = (payload) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    ready.resolve(false);
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1000, 'Load-test session complete');
    }
    result.resolve({
      user: index + 1,
      marker,
      turns: completedTurns,
      ...payload,
    });
  };

  const fail = (error) => finish({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });

  const timer = setTimeout(
    () => fail(new Error(`Session timed out after ${timeoutMs * turnCount} ms`)),
    timeoutMs * turnCount,
  );

  socket.on('open', () => {
    connectedAt = performance.now();
    const systemPrompt = `${productionPrompt}

# Controlled staging load-test instruction
Reply to every question in exactly one short sentence of no more than 24 words.
Begin that sentence exactly with "${marker}."`;
    socket.send(JSON.stringify({
      type: 'session.init',
      systemPrompt,
    }));
  });

  socket.on('message', async (raw) => {
    if (settled) return;
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      fail(new Error('Gateway returned invalid JSON.'));
      return;
    }

    if (message.type === 'session.ready') {
      readyAt = performance.now();
      ready.resolve(true);
      return;
    }
    if (message.type === 'user.text.done') {
      if (!currentTurn) return;
      currentTurn.transcript = String(message.text || '');
      currentTurn.transcriptAt = performance.now();
      return;
    }
    if (message.type === 'assistant.text.delta' && currentTurn?.assistantFirstTokenAt == null) {
      currentTurn.assistantFirstTokenAt = performance.now();
      return;
    }
    if (message.type === 'assistant.text.done') {
      if (!currentTurn || currentTurn.processingAssistant) return;
      currentTurn.processingAssistant = true;
      currentTurn.assistantDoneAt = performance.now();
      currentTurn.assistantText = String(message.text || '').trim();
      try {
        const chunks = splitResponseChunks(currentTurn.assistantText);
        if (chunks.length === 0) throw new Error('Assistant response contained no speakable text.');
        const ttsStartedAt = performance.now();
        const chunkResults = [];
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          const chunkStartedAt = performance.now();
          const response = await fetch(
            `${ttsUrl}?chatbotLoadTest=${Date.now()}-${index}-${turnIndex}-${chunkIndex}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
              },
              body: JSON.stringify({
                voiceProfileId,
                text: chunks[chunkIndex],
                ...(chunkIndex === 0 ? { skip_verify: true } : {}),
              }),
              signal: AbortSignal.timeout(timeoutMs),
            },
          );
          const audioResponse = Buffer.from(await response.arrayBuffer());
          const chunkDoneAt = performance.now();
          if (chunkIndex === 0) currentTurn.firstVoiceAt = chunkDoneAt;
          chunkResults.push({
            index: chunkIndex + 1,
            status: response.status,
            bytes: audioResponse.length,
            latencyMs: chunkDoneAt - chunkStartedAt,
            ok: response.ok
              && response.headers.get('content-type')?.startsWith('audio/wav')
              && audioResponse.subarray(0, 4).toString('ascii') === 'RIFF',
          });
          if (!chunkResults.at(-1).ok) break;
        }
        const ttsDoneAt = performance.now();
        const ownMarker = containsUserMarker(currentTurn.assistantText, index + 1);
        const foreignMarkers = Array.from(
          { length: concurrency },
          (_, markerIndex) => markerIndex + 1,
        ).filter(
          (value) => value !== index + 1
            && containsUserMarker(currentTurn.assistantText, value),
        );
        const validWavs = chunkResults.length === chunks.length
          && chunkResults.every((chunk) => chunk.ok);

        const turnResult = {
          turn: turnIndex + 1,
          ok: validWavs && foreignMarkers.length === 0,
          transcript: currentTurn.transcript || '',
          responseWords: currentTurn.assistantText.split(/\s+/u).filter(Boolean).length,
          responseChunks: chunks.length,
          ownMarker,
          foreignMarkers,
          ttsStatus: chunkResults.map((chunk) => chunk.status),
          ttsBytes: chunkResults.reduce((sum, chunk) => sum + chunk.bytes, 0),
          chunkLatencyMs: chunkResults.map((chunk) => Math.round(chunk.latencyMs)),
          timingsMs: {
            speechToTranscript: currentTurn.transcriptAt == null
              || currentTurn.speechEndedAt == null
              ? null
              : currentTurn.transcriptAt - currentTurn.speechEndedAt,
            speechToFirstToken: currentTurn.assistantFirstTokenAt == null
              || currentTurn.speechEndedAt == null
              ? null
              : currentTurn.assistantFirstTokenAt - currentTurn.speechEndedAt,
            speechToTextDone: currentTurn.speechEndedAt == null
              ? null
              : currentTurn.assistantDoneAt - currentTurn.speechEndedAt,
            timeToFirstVoice: currentTurn.firstVoiceAt == null
              || currentTurn.inputStartedAt == null
              ? null
              : currentTurn.firstVoiceAt - currentTurn.inputStartedAt,
            speechToFirstVoice: currentTurn.firstVoiceAt == null
              || currentTurn.speechEndedAt == null
              ? null
              : currentTurn.firstVoiceAt - currentTurn.speechEndedAt,
            voiceSynthesis: ttsDoneAt - ttsStartedAt,
            endToEnd: currentTurn.inputStartedAt == null
              ? null
              : ttsDoneAt - currentTurn.inputStartedAt,
          },
          responseSample: currentTurn.assistantText.slice(0, 240),
        };
        completedTurns.push(turnResult);
        if (!turnResult.ok) {
          finish({ ok: false, error: `Turn ${turnIndex + 1} voice generation failed.` });
        } else if (completedTurns.length === turnCount) {
          finish({
            ok: true,
            connectMs: Math.round(connectedAt - createdAt),
            sessionReadyMs: Math.round(readyAt - createdAt),
          });
        } else {
          await new Promise((resolve) => setTimeout(resolve, thinkTimeMs));
          await startNextTurn();
        }
      } catch (error) {
        fail(error);
      }
      return;
    }
    if (message.type === 'error') {
      fail(new Error(message.message || message.code || 'Gateway error'));
    }
  });

  socket.on('error', (error) => fail(error));
  socket.on('close', (code, reason) => {
    if (!settled) fail(new Error(`WebSocket closed (${code}): ${reason.toString()}`));
  });

  async function startNextTurn() {
    if (settled) return;
    turnIndex += 1;
    currentTurn = {
      inputStartedAt: performance.now(),
      assistantFirstTokenAt: null,
      assistantText: '',
      transcript: '',
      processingAssistant: false,
    };
    const frameBytes = Math.max(
      audio.blockAlign,
      Math.floor((audio.sampleRate * audio.blockAlign * audioFrameMs) / 1000),
    );
    const trailingSilence = Buffer.alloc(
      Math.round(audio.sampleRate * audio.blockAlign * 0.36),
    );
    const sendPcm = async (payload) => {
      for (let offset = 0; offset < payload.length; offset += frameBytes) {
        if (settled) return false;
        const frame = payload.subarray(offset, Math.min(payload.length, offset + frameBytes));
        socket.send(JSON.stringify({
          type: 'audio.chunk',
          audio: frame.toString('base64'),
        }));
        if (paceAudio) {
          const frameDurationMs = (frame.length / audio.blockAlign / audio.sampleRate) * 1000;
          await new Promise((resolve) => setTimeout(resolve, frameDurationMs));
        }
      }
      return true;
    };
    if (!await sendPcm(audio.pcm)) return;
    currentTurn.speechEndedAt = performance.now();
    if (!await sendPcm(trailingSilence)) return;
    currentTurn.inputCommittedAt = performance.now();
    if (manualCommit) {
      socket.send(JSON.stringify({ type: 'input.commit' }));
    }
  }

  async function start() {
    if (settled || started) return;
    started = true;
    await startNextTurn();
  }

  return {
    ready: ready.promise,
    result: result.promise,
    start,
  };
}

ensureLoadTestAudio(audioPath);
const audio = readPcmWav(audioPath);
const productionPrompt = loadProductionSystemPrompt();
const wallStartedAt = performance.now();
const sessions = Array.from(
  { length: concurrency },
  (_, index) => makeSession(index, audio, productionPrompt),
);
const readyStates = await Promise.all(sessions.map((session) => session.ready));
const readyCount = readyStates.filter(Boolean).length;
await Promise.all(
  sessions.map((session, index) => (readyStates[index] ? session.start() : undefined)),
);
const results = await Promise.all(sessions.map((session) => session.result));
const wallMs = performance.now() - wallStartedAt;
const successful = results.filter((item) => item.ok);
const failures = results.filter((item) => !item.ok);

const turnSummaries = Array.from({ length: turnCount }, (_, index) => {
  const turnResults = results
    .map((item) => item.turns?.[index])
    .filter(Boolean);
  const metric = (name) => summarize(
    turnResults.map((item) => item.timingsMs?.[name]).filter(Number.isFinite),
  );
  return {
    turn: index + 1,
    completed: turnResults.filter((item) => item.ok).length,
    failed: concurrency - turnResults.filter((item) => item.ok).length,
    responseWords: summarize(turnResults.map((item) => item.responseWords)),
    responseChunks: summarize(turnResults.map((item) => item.responseChunks)),
    latencyMs: {
      speechToTranscript: metric('speechToTranscript'),
      speechToFirstToken: metric('speechToFirstToken'),
      speechToTextDone: metric('speechToTextDone'),
      timeToFirstVoice: metric('timeToFirstVoice'),
      speechToFirstVoice: metric('speechToFirstVoice'),
      firstVoiceChunk: summarize(
        turnResults.map((item) => item.chunkLatencyMs?.[0]).filter(Number.isFinite),
      ),
      voiceSynthesis: metric('voiceSynthesis'),
      endToEnd: metric('endToEnd'),
    },
  };
});

const report = {
  wsUrl,
  ttsUrl,
  concurrency,
  turnCount,
  thinkTimeMs,
  ready: readyCount,
  success: successful.length,
  failed: failures.length,
  wallMs: Math.round(wallMs),
  turnSummaries,
  isolation: {
    ownMarker: results.filter((item) => item.ownMarker).length,
    foreignMarker: results.filter((item) => item.foreignMarkers?.length > 0).length,
  },
  responseSamples: successful.slice(0, 3).map((item) => ({
    user: item.user,
    transcript: item.turns?.[0]?.transcript,
    response: item.turns?.[0]?.responseSample,
  })),
  sessions: results,
};
if (reportFile) {
  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({
  ...report,
  ...(reportFile ? { reportFile, sessions: undefined } : {}),
}, null, 2));
