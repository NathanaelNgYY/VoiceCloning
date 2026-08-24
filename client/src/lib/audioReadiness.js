export function withAudioCacheBuster(url, {
  now = Date.now(),
  baseUrl = globalThis.location?.href || 'http://localhost/',
} = {}) {
  if (!url || String(url).startsWith('blob:')) return url;
  try {
    const parsed = new URL(url, baseUrl);
    parsed.searchParams.set('_audioReady', String(now));
    return parsed.toString();
  } catch {
    const separator = String(url).includes('?') ? '&' : '?';
    return `${url}${separator}_audioReady=${now}`;
  }
}

export function waitForAudioMetadata(url, {
  timeoutMs = 6000,
  AudioCtor = globalThis.Audio,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  return new Promise((resolve, reject) => {
    if (typeof AudioCtor !== 'function') {
      reject(new Error('Audio playback is unavailable in this browser.'));
      return;
    }
    const audio = new AudioCtor();
    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimer(timer);
      audio.onloadedmetadata = null;
      audio.oncanplay = null;
      audio.onerror = null;
    };
    const done = (ok) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (ok) resolve();
      else reject(new Error('Generated audio is still being finalized.'));
    };
    timer = setTimer(() => done(false), timeoutMs);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(true);
    audio.oncanplay = () => done(true);
    audio.onerror = () => done(false);
    audio.src = url;
    audio.load();
  });
}

async function hasWavHeader(blob) {
  if (!blob || typeof blob.slice !== 'function') return false;
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (bytes.length < 12) return false;
  return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE';
}

async function fetchPlayableBlob(url, { fetchImpl, createObjectURL }) {
  if (typeof fetchImpl !== 'function' || typeof createObjectURL !== 'function') return null;
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Generated audio returned HTTP ${response.status}.`);
  const blob = await response.blob();
  if (!blob || blob.size <= 44) throw new Error('Generated audio file is incomplete.');
  return {
    url: createObjectURL(blob),
    verifiedAudio: String(blob.type || '').toLowerCase().startsWith('audio/') || await hasWavHeader(blob),
  };
}

export async function waitForPlayableAudioSource(url, {
  attempts = 12,
  delayMs = 700,
  fetchImpl = globalThis.fetch,
  createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
  revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL),
  waitForMetadata = waitForAudioMetadata,
  isDocumentHidden = () => globalThis.document?.visibilityState === 'hidden',
  sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const candidateUrl = withAudioCacheBuster(url, { now: now() });
    let blobUrl = null;
    try {
      // Fetching the completed WAV into a blob removes the race between an <audio>
      // metadata range request and a just-written/just-uploaded final artifact.
      const fetchedBlob = await fetchPlayableBlob(candidateUrl, { fetchImpl, createObjectURL });
      blobUrl = fetchedBlob?.url || null;
      const playableUrl = blobUrl || candidateUrl;
      // Browsers may suspend media metadata events in a background tab. A fully
      // downloaded non-empty blob is already durable enough to add to history;
      // requiring an Audio event while hidden turns successful generation into a
      // false “still being finalized” error when the user returns to the tab.
      if (blobUrl && fetchedBlob.verifiedAudio && isDocumentHidden()) return blobUrl;
      await waitForMetadata(playableUrl);
      return playableUrl;
    } catch (error) {
      lastError = error;
      if (blobUrl && typeof revokeObjectURL === 'function') revokeObjectURL(blobUrl);
      // Cross-origin audio can be playable even when CORS blocks fetch(). Preserve
      // that browser-native path before treating this attempt as unavailable.
      if (!blobUrl) {
        try {
          await waitForMetadata(candidateUrl);
          return candidateUrl;
        } catch (metadataError) {
          lastError = metadataError;
        }
      }
      if (attempt < attempts) await sleep(Math.min(4000, delayMs * attempt));
    }
  }
  throw lastError || new Error('Generated audio is still being finalized.');
}
