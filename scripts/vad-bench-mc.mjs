// Turn-detection benchmark against the public staging MC gateway.
// Streams a continuous real-time "mic" (24 kHz PCM, 100 ms chunks) containing
// scripted utterances with natural mid-sentence pauses, and measures for each
// turn-detection config: how fast the turn ends after the speaker stops, how
// often a pause wrongly splits the turn, and transcript word accuracy.
// Usage: node scripts/vad-bench-mc.mjs [configsJson] [noiseRms=0] [gain=1]
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MC_SYSTEM_PROMPT } from '../client/src/lib/mcSession.js';
import { createStreamingResampler } from '../client/src/lib/micResampler.js';
const require = createRequire(new URL('../live-gateway/package.json', import.meta.url));
const WebSocket = require('ws');
const origin = 'https://d32nzk2gacfhag.cloudfront.net';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RATE = 24000;
const CHUNK = 2400;

const UTTERANCES = [
  ['Good evening everyone, and welcome to the NTU Innovation Evening.'],
  ['So I was thinking', 700, 'about who should speak first tonight.'],
  ['Our first guest is', 1100, 'Professor Lim from the School of Computing and Data Science.'],
  ['Can you tell the audience a little about yourself?'],
  ['Right, and after that', 500, 'we will move on to the panel discussion with our students.'],
  ['Thank you.'],
  ['Please welcome Doctor Nguyen and Associate Professor Tan Wei Ling to the stage.'],
  ['Yes.'],
];

const DEFAULT_CONFIGS = [
  { name: 'semantic-auto', turnDetection: { type: 'semantic_vad', eagerness: 'auto' } },
  { name: 'semantic-high', turnDetection: { type: 'semantic_vad', eagerness: 'high' } },
  { name: 'server-500', turnDetection: { type: 'server_vad', threshold: 0.5, silenceMs: 500, prefixMs: 300 } },
  { name: 'server-800', turnDetection: { type: 'server_vad', threshold: 0.5, silenceMs: 800, prefixMs: 300 } },
];

function wavPcm(buffer) {
  let format;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const kind = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    if (kind === 'fmt ') format = { rate: buffer.readUInt32LE(offset + 12), bits: buffer.readUInt16LE(offset + 22) };
    if (kind === 'data') {
      const data = buffer.subarray(offset + 8, offset + 8 + length);
      const samples = new Float32Array(data.length / 2);
      for (let i = 0; i < samples.length; i += 1) samples[i] = data.readInt16LE(i * 2) / 32768;
      return { rate: format.rate, samples };
    }
    offset += 8 + length + (length % 2);
  }
  throw new Error('No WAV data');
}

function trim(samples) {
  let start = 0;
  let end = samples.length;
  while (start < end && Math.abs(samples[start]) < 0.01) start += 1;
  while (end > start && Math.abs(samples[end - 1]) < 0.01) end -= 1;
  return samples.subarray(Math.max(0, start - 600), Math.min(samples.length, end + 600));
}

async function speech(text) {
  mkdirSync('.tmp/vadbench', { recursive: true });
  const file = `.tmp/vadbench/${createHash('sha1').update(text).digest('hex').slice(0, 12)}.wav`;
  if (!existsSync(file)) {
    const body = JSON.stringify({ text, voiceProfileId: 'deanvoice-v1', text_lang: 'en', skip_verify: true });
    const response = await fetch(`${origin}/api/live/tts-sentence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'x-amz-content-sha256': createHash('sha256').update(body).digest('hex') },
      body,
    });
    if (!response.ok) throw new Error(`TTS ${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const wav = wavPcm(readFileSync(file));
  return trim(createStreamingResampler(wav.rate, RATE)(wav.samples));
}

async function buildUtterance(parts, gain) {
  const pieces = [];
  for (const part of parts) pieces.push(typeof part === 'number' ? new Float32Array(Math.round((RATE * part) / 1000)) : await speech(part));
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const audio = new Float32Array(total);
  let offset = 0;
  for (const piece of pieces) { audio.set(piece, offset); offset += piece.length; }
  for (let i = 0; i < audio.length; i += 1) audio[i] *= gain;
  return { audio, text: parts.filter((part) => typeof part === 'string').join(' ') };
}

const words = (text) => String(text).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
function wordErrorRate(truth, heard) {
  const a = words(truth);
  const b = words(heard);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length] / Math.max(1, a.length);
}

// A second voice murmuring under the host (BACKGROUND_GAIN env) to test whether
// the noise filter keeps background talk from starting false turns.
const BACKGROUND = ['The coffee break will be in the main hall after this session.', 'Has anyone seen the projector remote for room three?', 'I think the car park is full already, we should take the train.'];

async function runConfig(config, utterances, noiseRms, background) {
  const socket = new WebSocket(`${origin.replace('https:', 'wss:')}/api/live/chat/realtime?language=en`, { origin });
  const events = [];
  socket.on('message', (data) => { const event = JSON.parse(data.toString()); event.at = Date.now(); events.push(event); });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'session.init', systemPrompt: MC_SYSTEM_PROMPT, turnDetection: config.turnDetection, ...(config.extra || {}) }));
  const readyBy = Date.now() + 20000;
  while (!events.some((e) => e.type === 'session.ready')) { if (Date.now() > readyBy) throw new Error('no session.ready'); await wait(50); }

  // Continuous real-time mic: queued speech, otherwise silence or noise.
  let queue = [];
  let lastSpeechSentAt = 0;
  let bgIndex = 0;
  const windows = [];
  const amplitude = noiseRms * Math.sqrt(3);
  const pump = setInterval(() => {
    const chunk = new Float32Array(CHUNK);
    let speechInChunk = false;
    for (let i = 0; i < CHUNK; i += 1) {
      let noise = amplitude ? (Math.random() * 2 - 1) * amplitude : 0;
      if (background) { noise += background[bgIndex % background.length]; bgIndex += 1; }
      if (queue.length) { chunk[i] = queue[0].samples[queue[0].index] + noise; queue[0].index += 1; speechInChunk = true; if (queue[0].index >= queue[0].samples.length) { queue[0].done(); queue.shift(); } } else chunk[i] = noise;
    }
    if (speechInChunk) lastSpeechSentAt = Date.now();
    const pcm = Buffer.alloc(CHUNK * 2);
    for (let i = 0; i < CHUNK; i += 1) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chunk[i] * 32767))), i * 2);
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'audio.chunk', audio: pcm.toString('base64') }));
  }, 100);

  const results = [];
  for (const utterance of utterances) {
    await wait(1500);
    const from = events.length;
    const startedAt = Date.now();
    await new Promise((resolve) => queue.push({ samples: utterance.audio, index: 0, done: resolve }));
    await wait(100);
    const endAt = lastSpeechSentAt;
    windows.push([startedAt - 300, endAt + 300]);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const tail = events.slice(from);
      const stoppedAfterEnd = tail.find((e) => e.type === 'user.speech.stopped' && e.at >= endAt - 150);
      if (stoppedAfterEnd && tail.some((e) => e.type === 'assistant.text.done' && e.at >= stoppedAfterEnd.at)
        && tail.filter((e) => e.type === 'user.text.done').length >= tail.filter((e) => e.type === 'user.speech.stopped').length) break;
      await wait(50);
    }
    const tail = events.slice(from);
    const stops = tail.filter((e) => e.type === 'user.speech.stopped');
    const finalStop = stops.find((e) => e.at >= endAt - 150);
    const splits = stops.filter((e) => e.at < endAt - 150 && e.at > startedAt).length;
    const reply = finalStop && tail.find((e) => e.type === 'assistant.text.done' && e.at >= finalStop.at);
    const heard = tail.filter((e) => e.type === 'user.text.done').map((e) => e.text).join(' ');
    results.push({
      text: utterance.text,
      endMs: finalStop ? finalStop.at - endAt : null,
      replyMs: reply ? reply.at - endAt : null,
      splits,
      wer: wordErrorRate(utterance.text, heard),
      heard,
    });
    await wait(2000);
  }
  clearInterval(pump);
  socket.close();
  results.falseTurns = events.filter((e) => e.type === 'user.speech.started' && !windows.some(([a, b]) => e.at >= a && e.at <= b)).length;
  const errors = events.filter((e) => e.type === 'error' || /failed/.test(e.type));
  for (const e of errors) console.log('OPENAI/GATEWAY ERROR', config.name, JSON.stringify(e).slice(0, 300));
  results.errors = errors.length;
  return results;
}

const configs = process.argv[2] ? JSON.parse(process.argv[2]) : DEFAULT_CONFIGS;
const noiseRms = Number(process.argv[3] || 0);
const gain = Number(process.argv[4] || 1);
const utterances = [];
for (const parts of UTTERANCES) utterances.push(await buildUtterance(parts, gain));
const backgroundGain = Number(process.env.BACKGROUND_GAIN || 0);
let background = null;
if (backgroundGain) {
  const parts = [];
  for (const text of BACKGROUND) parts.push(text, 600);
  background = (await buildUtterance(parts, backgroundGain)).audio;
}
const summary = [];
for (const config of configs) {
  const results = await runConfig(config, utterances, noiseRms, background);
  for (const r of results) console.log(JSON.stringify({ config: config.name, ...r }));
  const ok = results.filter((r) => r.endMs !== null);
  const median = (values) => { const sorted = [...values].sort((x, y) => x - y); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
  summary.push({
    config: config.name,
    medianEndMs: median(ok.map((r) => r.endMs)),
    maxEndMs: ok.length ? Math.max(...ok.map((r) => r.endMs)) : null,
    medianReplyMs: median(ok.filter((r) => r.replyMs !== null).map((r) => r.replyMs)),
    splits: results.reduce((sum, r) => sum + r.splits, 0),
    missed: results.length - ok.length,
    meanWer: Number((results.reduce((sum, r) => sum + r.wer, 0) / results.length).toFixed(3)),
    errors: results.errors,
    falseTurns: results.falseTurns,
  });
}
console.log(`\nnoiseRms=${noiseRms} gain=${gain}`);
console.table(summary);
