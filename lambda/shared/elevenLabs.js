// ElevenLabs stock voices, offered alongside the lecturers' own cloned voices.
//
// These exist for two reasons: a lecturer who has not trained yet still needs a
// working kiosk, and a lecturer who has trained sometimes wants a neutral
// narrator instead of themselves. They are deliberately *stock library* voices
// only — cloning a lecturer here would duplicate what GPT-SoVITS already does
// and would ship their voice to a third party.
//
// Identity is carried in the voiceProfileId as `elevenlabs:<voiceId>`, so every
// call site can tell which backend a voice belongs to without an S3 read. That
// matters on the synthesis path, which is latency-sensitive and runs per
// sentence of every reply.

const API_ROOT = 'https://api.elevenlabs.io';
const ID_PREFIX = 'elevenlabs:';

// ~75ms time-to-first-byte and the cheapest per character, which is what a
// per-sentence chat reply needs. Quality-over-latency deployments can move to
// eleven_multilingual_v2 or eleven_v3_conversational through the env var.
const DEFAULT_MODEL_ID = 'eleven_flash_v2_5';

// mp3 is the only family with no subscription-tier restriction: 44.1kHz WAV and
// PCM need Pro, and 192kbps mp3 needs Creator. Defaulting to the universally
// available format keeps this working on whatever tier the account is on, and
// the response's own content-type is what reaches the browser.
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

// A chat reply is synthesised one sentence at a time, so anything this long is
// a sentence-splitting failure rather than a real sentence. ElevenLabs bills per
// character, so the cap is a cost guard, not just a sanity check.
const DEFAULT_MAX_CHARS = 800;

// Long enough that a page refresh does not re-fetch the catalogue, short enough
// that a voice added in the ElevenLabs dashboard shows up the same day.
const VOICE_CACHE_TTL_MS = 10 * 60 * 1000;

// Warm Lambda containers reuse this; a cold start simply refills it.
let voiceCache = { expiresAt: 0, voices: [] };

export class ElevenLabsError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'ElevenLabsError';
    this.statusCode = statusCode;
  }
}

function readConfig(env = process.env) {
  return {
    apiKey: String(env.ELEVENLABS_API_KEY || '').trim(),
    modelId: String(env.ELEVENLABS_MODEL_ID || '').trim() || DEFAULT_MODEL_ID,
    outputFormat: String(env.ELEVENLABS_OUTPUT_FORMAT || '').trim() || DEFAULT_OUTPUT_FORMAT,
    // Empty means "every voice on the account". Set it to curate which voices
    // lecturers see without needing a code change.
    allowedVoiceIds: String(env.ELEVENLABS_VOICE_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    maxChars: Number.parseInt(env.ELEVENLABS_MAX_CHARS || '', 10) || DEFAULT_MAX_CHARS,
  };
}

export function isElevenLabsConfigured(env = process.env) {
  return readConfig(env).apiKey !== '';
}

/** `elevenlabs:<voiceId>` → `<voiceId>`; anything else → ''. */
export function parseElevenLabsVoiceId(voiceProfileId) {
  const value = String(voiceProfileId || '').trim();
  if (!value.toLowerCase().startsWith(ID_PREFIX)) return '';
  return value.slice(ID_PREFIX.length).trim();
}

export function buildElevenLabsProfileId(voiceId) {
  const value = String(voiceId || '').trim();
  return value ? `${ID_PREFIX}${value}` : '';
}

export function isElevenLabsRequest(body = {}) {
  return parseElevenLabsVoiceId(body?.voiceProfileId) !== '';
}

function summarizeVoice(voice) {
  const voiceId = String(voice?.voice_id || '').trim();
  if (!voiceId) return null;
  const labels = voice?.labels && typeof voice.labels === 'object' ? voice.labels : {};
  return {
    voiceProfileId: buildElevenLabsProfileId(voiceId),
    displayName: String(voice?.name || '').trim() || voiceId,
    provider: 'elevenlabs',
    // A stock voice needs no reference clip or synthesis settings, so it is
    // always ready to speak — the client uses this to skip the model-load gate.
    hasSavedProfile: true,
    // Nobody owns a stock voice; it is offered to every lecturer alike. The
    // faculty list uses this to keep them out of the "my voice" group.
    isMine: false,
    ...(labels.accent ? { accent: String(labels.accent) } : {}),
    ...(labels.gender ? { gender: String(labels.gender) } : {}),
    ...(voice?.description ? { description: String(voice.description) } : {}),
    ...(voice?.preview_url ? { previewUrl: String(voice.preview_url) } : {}),
  };
}

/**
 * The curated premade set (~21 voices). `voice_type=default` is what separates
 * these from the community library, which is far too large to put in a dropdown.
 * Returns null to mean "the lookup failed" — distinct from "no voices".
 */
async function fetchDefaultVoices(config, fetchImpl) {
  try {
    const response = await fetchImpl(`${API_ROOT}/v2/voices?page_size=100&voice_type=default`, {
      method: 'GET',
      headers: { 'xi-api-key': config.apiKey },
    });
    if (!response.ok) {
      console.warn(`[elevenLabs] default voice list failed (${response.status})`);
      return null;
    }
    const payload = await response.json();
    return (Array.isArray(payload?.voices) ? payload.voices : [])
      .map((voice) => summarizeVoice(voice))
      .filter(Boolean);
  } catch (error) {
    console.warn(`[elevenLabs] default voice list failed: ${error.message}`);
    return null;
  }
}

/**
 * Resolve each allowlisted id on its own, so the shortlist can name any voice —
 * premade, community, or one cloned on the account — without depending on which
 * page of which listing it happens to fall on. One bad id drops that voice
 * rather than emptying the whole shortlist.
 */
async function fetchVoicesById(config, fetchImpl) {
  const results = await Promise.all(config.allowedVoiceIds.map(async (voiceId) => {
    try {
      const response = await fetchImpl(`${API_ROOT}/v1/voices/${encodeURIComponent(voiceId)}`, {
        method: 'GET',
        headers: { 'xi-api-key': config.apiKey },
      });
      if (!response.ok) {
        console.warn(`[elevenLabs] voice ${voiceId} lookup failed (${response.status})`);
        return null;
      }
      return summarizeVoice(await response.json());
    } catch (error) {
      console.warn(`[elevenLabs] voice ${voiceId} lookup failed: ${error.message}`);
      return null;
    }
  }));
  const voices = results.filter(Boolean);
  // Every id failing means the API is unreachable, not that the shortlist is
  // empty — keep whatever was cached rather than blanking the panel.
  return voices.length === 0 && config.allowedVoiceIds.length > 0 ? null : voices;
}

/**
 * The stock voices to offer, newest catalogue first but cached.
 *
 * Never throws: not being able to reach ElevenLabs must not stop a lecturer
 * seeing their own trained voices, which is the more important half of the
 * list. The caller gets an empty array and the panel simply shows no stock
 * voices.
 */
export async function listElevenLabsVoices({
  env = process.env,
  fetchImpl = fetch,
  now = () => Date.now(),
  cache = null,
} = {}) {
  const config = readConfig(env);
  if (!config.apiKey) return [];

  const store = cache || voiceCache;
  if (store.expiresAt > now() && store.voices.length > 0) {
    return store.voices;
  }

  // Two different lookups, because filtering a list would silently return
  // nothing. `/v2/voices` defaults to the ~400-voice *shared community library*,
  // paginated — the premade voices an allowlist actually names are not in it, so
  // an allowlist applied to that list matched zero voices. Fetch allowlisted ids
  // directly, and fall back to the curated premade set when none is configured.
  const filtered = config.allowedVoiceIds.length > 0
    ? await fetchVoicesById(config, fetchImpl)
    : await fetchDefaultVoices(config, fetchImpl);

  if (filtered === null) return store.voices;

  filtered.sort((left, right) => left.displayName.localeCompare(right.displayName));

  const next = { expiresAt: now() + VOICE_CACHE_TTL_MS, voices: filtered };
  if (cache) {
    cache.expiresAt = next.expiresAt;
    cache.voices = next.voices;
  } else {
    voiceCache = next;
  }
  return filtered;
}

/** Test seam: drops the warm-container catalogue cache. */
export function resetElevenLabsVoiceCache() {
  voiceCache = { expiresAt: 0, voices: [] };
}

/**
 * Synthesise one sentence, returning the same `{ buffer, contentType }` shape
 * the GPU worker returns so the caller's response path is unchanged.
 */
export async function synthesizeElevenLabsSpeech(body = {}, {
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const config = readConfig(env);
  if (!config.apiKey) {
    throw new ElevenLabsError(503, 'Standard voices are not configured on this server.');
  }

  const voiceId = parseElevenLabsVoiceId(body.voiceProfileId);
  if (!voiceId) {
    throw new ElevenLabsError(400, 'Not an ElevenLabs voice.');
  }

  const text = String(body.text || '').trim();
  if (!text) {
    throw new ElevenLabsError(400, 'text is required');
  }
  if (text.length > config.maxChars) {
    // Rejected rather than truncated: silently cutting a sentence would produce
    // audio that does not match what the reply said.
    throw new ElevenLabsError(
      400,
      `Text is ${text.length} characters; the limit for a standard voice is ${config.maxChars}.`,
    );
  }

  let response;
  try {
    response = await fetchImpl(
      `${API_ROOT}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(config.outputFormat)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': config.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/*',
        },
        body: JSON.stringify({
          text,
          model_id: config.modelId,
        }),
      },
    );
  } catch (error) {
    throw new ElevenLabsError(502, `Standard voice service unreachable: ${error.message}`);
  }

  if (!response.ok) {
    // The upstream body can carry the account's own details (quota, plan). Log
    // it for us, but hand the browser a plain message.
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 500);
    } catch {
      detail = '(unreadable body)';
    }
    console.warn(`[elevenLabs] synthesis failed (${response.status}): ${detail}`);
    if (response.status === 401 || response.status === 403) {
      throw new ElevenLabsError(503, 'Standard voice credentials were rejected.');
    }
    if (response.status === 429) {
      throw new ElevenLabsError(429, 'Standard voice quota reached. Try again later.');
    }
    throw new ElevenLabsError(502, `Standard voice synthesis failed (${response.status}).`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    // Honoured downstream rather than assumed: the configured output format
    // decides whether this is mp3, wav, or opus.
    contentType: response.headers.get('content-type') || 'audio/mpeg',
    characterCount: text.length,
  };
}
