import path from 'path';
import { getObject, listObjects, uploadBuffer } from './s3.js';
import { loadClipScores } from './clipScores.js';
import { gpuGet, inferenceGet, inferencePost } from './gpuWorker.js';
import { useGpuWorkerArtifacts } from './artifacts.js';
import { isSafePathSegment } from './paths.js';

const ACTIVE_PROFILE_KEY = 'voice-profiles/active.json';
const MIN_REUSABLE_AUX_REFS = 5;

export function modelSource() {
  return (process.env.MODEL_SOURCE || 's3').trim().toLowerCase();
}

export function useGpuWorkerModels() {
  return ['gpu-worker', 'gpu', 'local', 'gpt-sovits'].includes(modelSource());
}

const GOOD_NAME_RE = /(^|[_\-\s])(clean|clear|best|reference|ref|neutral|steady|natural)([_\-\s]|\d|$)/i;
const RISKY_NAME_RE = /(^|[_\-\s])(noisy|noise|music|bgm|silence|silent|long|bad|test)([_\-\s]|\d|$)/i;
const GOOD_AUDIO_EXTENSIONS = new Set(['.wav', '.flac']);
const OK_AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.ogg', '.webm', '.mp4']);

function getBasename(filePath = '') {
  return String(filePath || '').replace(/\\/g, '/').split('/').pop() || '';
}

function extensionOf(filename = '') {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

function normalizeLang(lang = '') {
  return String(lang || '').trim().toLowerCase();
}

function transcriptScore(transcript = '') {
  const clean = String(transcript || '').replace(/\s+/g, ' ').trim();
  if (!clean) return -12;

  const wordCount = clean.split(' ').filter(Boolean).length;
  if (wordCount < 3) return 4;
  if (wordCount <= 5) return 22;
  if (wordCount <= 18) return 42;
  if (wordCount <= 24) return 36;
  if (wordCount <= 45) return 24;
  return 8;
}

function langScore(lang = '') {
  const normalized = normalizeLang(lang);
  if (normalized === 'en' || normalized === 'eng') return 14;
  if (normalized === 'auto' || !normalized) return 3;
  return 0;
}

function scoreReferenceClip(file) {
  const audioScore = Number(file?.qualityScore);
  if (Number.isFinite(audioScore)) {
    // Audio quality dominates; transcript + language guard so the PRIMARY
    // (whose transcript becomes prompt_text) isn't a clean clip with no text.
    return audioScore + 0.3 * (transcriptScore(file?.transcript) + langScore(file?.lang));
  }

  const filename = file?.filename || getBasename(file?.path);
  const ext = extensionOf(filename);

  let score = transcriptScore(file?.transcript);

  if (GOOD_AUDIO_EXTENSIONS.has(ext)) score += 18;
  else if (OK_AUDIO_EXTENSIONS.has(ext)) score += 6;

  score += langScore(file?.lang);

  if (GOOD_NAME_RE.test(filename)) score += 14;
  if (/(^|[_\-\s])(reference|ref)([_\-\s]|\d|$)/i.test(filename)) score += 8;
  if (/(^|[_\-\s])(aux|auxiliary)([_\-\s]|\d|$)/i.test(filename)) score -= 4;
  if (RISKY_NAME_RE.test(filename)) score -= 32;

  return score;
}

function chooseBestReferenceSet(files, { maxAux = 5 } = {}) {
  const candidates = Array.isArray(files)
    ? files.filter((file) => file?.path && (file?.filename || getBasename(file?.path)))
    : [];

  if (candidates.length === 0) {
    return { primary: null, aux: [] };
  }

  const ranked = candidates
    .map((file) => ({ file, score: scoreReferenceClip(file) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.file.filename || getBasename(a.file.path))
        .localeCompare(b.file.filename || getBasename(b.file.path));
    });

  return {
    primary: ranked[0].file,
    aux: ranked.slice(1, maxAux + 1).map((entry) => entry.file),
  };
}

function extractExpNameFromModelRef(modelRef = '') {
  const basename = getBasename(modelRef);
  const match = basename.match(/^(.+?)[-_]e\d+(?:[_-]s\d+)?\.(?:ckpt|pth)$/i);
  return match ? match[1] : '';
}

async function loadTrainingAudioFilesForExp(expName) {
  const normalizedExpName = String(expName || '').trim();
  if (!normalizedExpName || !isSafePathSegment(normalizedExpName)) {
    return [];
  }

  if (useGpuWorkerArtifacts()) {
    const response = await gpuGet(`/training-audio/${encodeURIComponent(normalizedExpName)}`);
    return Array.isArray(response?.files) ? response.files : [];
  }

  const denoisedPrefix = `training/datasets/${normalizedExpName}/denoised/`;
  const objects = await listObjects(denoisedPrefix);
  const wavFiles = objects
    .filter((object) => object.key.endsWith('.wav'))
    .map((object) => path.basename(object.key))
    .sort();

  const transcriptMap = new Map();
  try {
    const asrBuffer = await getObject(`training/datasets/${normalizedExpName}/asr/denoised.list`);
    for (const line of asrBuffer.toString('utf-8').split('\n').filter(Boolean)) {
      const parts = line.split('|');
      if (parts.length >= 4) {
        const filename = getBasename(parts[0]);
        transcriptMap.set(filename, {
          transcript: parts.slice(3).join('|'),
          lang: parts[2],
        });
      }
    }
  } catch {
    // ASR file may not exist yet.
  }

  const clipScores = await loadClipScores(normalizedExpName);
  return wavFiles.map((filename) => {
    const info = transcriptMap.get(filename) || {};
    return {
      filename,
      key: `${denoisedPrefix}${filename}`,
      path: `${denoisedPrefix}${filename}`,
      transcript: info.transcript || '',
      lang: info.lang || '',
      qualityScore: clipScores.get(filename),
    };
  });
}

function normalizeReferenceWarmPayload({
  ref_audio_path = '',
  aux_ref_audio_paths = [],
} = {}) {
  const refAudioPath = String(ref_audio_path || '').trim();
  if (!refAudioPath) {
    return null;
  }

  return {
    ref_audio_path: refAudioPath,
    aux_ref_audio_paths: Array.isArray(aux_ref_audio_paths)
      ? aux_ref_audio_paths
        .map((item) => String(item || '').trim())
        .filter(Boolean)
      : [],
  };
}

function sameReferenceWarmPayload(left, right) {
  const normalizedLeft = normalizeReferenceWarmPayload(left);
  const normalizedRight = normalizeReferenceWarmPayload(right);

  if (!normalizedLeft || !normalizedRight) {
    return normalizedLeft === normalizedRight;
  }

  return (
    normalizedLeft.ref_audio_path === normalizedRight.ref_audio_path
    && normalizedLeft.aux_ref_audio_paths.length === normalizedRight.aux_ref_audio_paths.length
    && normalizedLeft.aux_ref_audio_paths.every((path, index) => path === normalizedRight.aux_ref_audio_paths[index])
  );
}

function hasAuxiliaryReferenceSelection(profile = {}) {
  return Array.isArray(profile?.aux_ref_audio_paths)
    && profile.aux_ref_audio_paths
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .length >= MIN_REUSABLE_AUX_REFS;
}

function getProfileStorageKey(voiceProfileId) {
  return `voice-profiles/${voiceProfileId}.json`;
}

function normalizeSavedProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  return {
    ...profile,
    ref_audio_path: String(profile.ref_audio_path || '').trim(),
    aux_ref_audio_paths: Array.isArray(profile.aux_ref_audio_paths)
      ? profile.aux_ref_audio_paths
        .map((item) => String(item || '').trim())
        .filter(Boolean)
      : [],
  };
}

function normalizeModelRef(value) {
  return String(value || '').trim();
}

function savedProfileMatchesModelPair(profile, {
  gptKey = '',
  gptPath = '',
  sovitsKey = '',
  sovitsPath = '',
} = {}) {
  const expectedGptRef = normalizeModelRef(gptKey || gptPath);
  const expectedSovitsRef = normalizeModelRef(sovitsKey || sovitsPath);
  const savedGptRef = normalizeModelRef(profile?.gptKey || profile?.gptPath);
  const savedSovitsRef = normalizeModelRef(profile?.sovitsKey || profile?.sovitsPath);

  if (expectedGptRef && savedGptRef && expectedGptRef !== savedGptRef) {
    return false;
  }
  if (expectedSovitsRef && savedSovitsRef && expectedSovitsRef !== savedSovitsRef) {
    return false;
  }

  return Boolean(
    (!expectedGptRef || !savedGptRef || expectedGptRef === savedGptRef)
    && (!expectedSovitsRef || !savedSovitsRef || expectedSovitsRef === savedSovitsRef)
  );
}

async function readSavedProfile(key, {
  readObject = getObject,
} = {}) {
  try {
    const raw = await readObject(key);
    if (!raw) return null;
    return normalizeSavedProfile(JSON.parse(raw.toString('utf-8')));
  } catch {
    return null;
  }
}

async function resolveSavedProfileWarmPayload({
  voiceProfileId = '',
  gptKey = '',
  gptPath = '',
  sovitsKey = '',
  sovitsPath = '',
} = {}, {
  readObject = getObject,
} = {}) {
  const normalizedVoiceProfileId = String(voiceProfileId || '').trim();
  if (normalizedVoiceProfileId && isSafePathSegment(normalizedVoiceProfileId)) {
    const profile = await readSavedProfile(getProfileStorageKey(normalizedVoiceProfileId), { readObject });
    if (!profile) {
      return null;
    }
    if (!savedProfileMatchesModelPair(profile, { gptKey, gptPath, sovitsKey, sovitsPath })) {
      return null;
    }

    const warmPayload = normalizeReferenceWarmPayload(profile);
    return warmPayload && hasAuxiliaryReferenceSelection(profile) ? warmPayload : null;
  }

  const activeProfile = await readSavedProfile(ACTIVE_PROFILE_KEY, { readObject });
  if (!activeProfile) {
    return null;
  }
  if (!savedProfileMatchesModelPair(activeProfile, { gptKey, gptPath, sovitsKey, sovitsPath })) {
    return null;
  }

  const warmPayload = normalizeReferenceWarmPayload(activeProfile);
  return warmPayload && hasAuxiliaryReferenceSelection(activeProfile) ? warmPayload : null;
}

export async function resolveSavedProfileReferenceSelection(profile, {
  listTrainingAudioFiles = loadTrainingAudioFilesForExp,
} = {}) {
  const normalizedProfile = profile || {};
  const existingSelection = normalizeReferenceWarmPayload(normalizedProfile);
  if (existingSelection && hasAuxiliaryReferenceSelection(normalizedProfile)) {
    return existingSelection;
  }

  const expName = extractExpNameFromModelRef(
    normalizedProfile.sovitsKey
    || normalizedProfile.sovitsPath
    || normalizedProfile.gptKey
    || normalizedProfile.gptPath,
  );
  if (!expName) {
    return existingSelection;
  }

  const files = await listTrainingAudioFiles(expName);
  const selection = chooseBestReferenceSet(files);
  if (!selection.primary) {
    return existingSelection;
  }

  return normalizeReferenceWarmPayload({
    ref_audio_path: selection.primary.path,
    aux_ref_audio_paths: selection.aux.map((file) => file.path),
  }) || existingSelection;
}

async function resolveSavedProfileReferenceWarmState({
  voiceProfileId = '',
  gptKey = '',
  gptPath = '',
  sovitsKey = '',
  sovitsPath = '',
} = {}, {
  listTrainingAudioFiles = loadTrainingAudioFilesForExp,
  readObject = getObject,
} = {}) {
  const normalizedVoiceProfileId = String(voiceProfileId || '').trim();
  const profile = normalizedVoiceProfileId && isSafePathSegment(normalizedVoiceProfileId)
    ? await readSavedProfile(getProfileStorageKey(normalizedVoiceProfileId), { readObject })
    : await readSavedProfile(ACTIVE_PROFILE_KEY, { readObject });

  if (!profile) {
    return null;
  }
  if (!savedProfileMatchesModelPair(profile, { gptKey, gptPath, sovitsKey, sovitsPath })) {
    return null;
  }

  const existingSelection = normalizeReferenceWarmPayload(profile);
  if (existingSelection && hasAuxiliaryReferenceSelection(profile)) {
    return {
      warmPayload: existingSelection,
      savedProfile: profile,
      shouldPersist: false,
    };
  }

  const resolvedSelection = await resolveSavedProfileReferenceSelection(profile, {
    listTrainingAudioFiles,
  });

  return {
    warmPayload: resolvedSelection || existingSelection,
    savedProfile: profile,
    shouldPersist: Boolean(
      resolvedSelection
      && profile?.voiceProfileId
      && !sameReferenceWarmPayload(existingSelection, resolvedSelection)
    ),
  };
}

async function resolveReferenceWarmState({
  voiceProfileId = '',
  gptKey = '',
  gptPath = '',
  sovitsKey = '',
  sovitsPath = '',
  ref_audio_path = '',
  aux_ref_audio_paths = [],
} = {}, {
  listTrainingAudioFiles = loadTrainingAudioFilesForExp,
  readObject = getObject,
} = {}) {
  const explicit = normalizeReferenceWarmPayload({ ref_audio_path, aux_ref_audio_paths });
  if (explicit) {
    return {
      warmPayload: explicit,
      savedProfile: null,
      shouldPersist: false,
    };
  }

  const savedProfileWarmState = await resolveSavedProfileReferenceWarmState({
    voiceProfileId,
    gptKey,
    gptPath,
    sovitsKey,
    sovitsPath,
  }, {
    listTrainingAudioFiles,
    readObject,
  });
  if (savedProfileWarmState?.warmPayload) {
    return savedProfileWarmState;
  }

  return {
    warmPayload: await resolveSavedProfileReferenceSelection({
      gptKey,
      gptPath,
      sovitsKey,
      sovitsPath,
      ref_audio_path,
      aux_ref_audio_paths,
    }, {
      listTrainingAudioFiles,
    }),
    savedProfile: null,
    shouldPersist: false,
  };
}

export async function persistSavedProfileReferenceSelection(profile, selection, {
  readObject = getObject,
  writeObject = uploadBuffer,
  now = () => new Date().toISOString(),
} = {}) {
  const normalizedProfile = normalizeSavedProfile(profile);
  const normalizedSelection = normalizeReferenceWarmPayload(selection);
  const voiceProfileId = String(normalizedProfile?.voiceProfileId || '').trim();

  if (!voiceProfileId || !normalizedSelection) {
    return false;
  }

  const existingSelection = normalizeReferenceWarmPayload(normalizedProfile);
  if (sameReferenceWarmPayload(existingSelection, normalizedSelection) && hasAuxiliaryReferenceSelection(normalizedProfile)) {
    return false;
  }

  const updatedAt = now();
  const {
    activatedAt: _ignoredActivatedAt,
    ...baseProfile
  } = normalizedProfile;
  const updatedProfile = {
    ...baseProfile,
    ...normalizedSelection,
    updatedAt,
  };

  await writeObject(
    getProfileStorageKey(voiceProfileId),
    Buffer.from(JSON.stringify(updatedProfile), 'utf-8'),
    'application/json',
  );

  const activeProfile = await readSavedProfile(ACTIVE_PROFILE_KEY, { readObject });
  const shouldWriteActiveProfile = String(activeProfile?.voiceProfileId || '').trim() === voiceProfileId
    || Boolean(normalizedProfile?.activatedAt);
  if (shouldWriteActiveProfile) {
    const activeBaseProfile = normalizeSavedProfile(activeProfile || normalizedProfile) || normalizedProfile;
    const updatedActiveProfile = {
      ...activeBaseProfile,
      ...updatedProfile,
      activatedAt: String(activeBaseProfile?.activatedAt || normalizedProfile?.activatedAt || updatedAt),
      updatedAt,
    };
    await writeObject(
      ACTIVE_PROFILE_KEY,
      Buffer.from(JSON.stringify(updatedActiveProfile), 'utf-8'),
      'application/json',
    );
  }

  return true;
}

async function warmModelReferences(payload, {
  postInference = inferencePost,
  listTrainingAudioFiles = loadTrainingAudioFilesForExp,
  readObject = getObject,
  writeObject = uploadBuffer,
  now = () => new Date().toISOString(),
} = {}) {
  try {
    const {
      warmPayload,
      savedProfile,
      shouldPersist,
    } = await resolveReferenceWarmState(payload, {
      listTrainingAudioFiles,
      readObject,
    });
    if (!warmPayload) {
      return null;
    }
    if (savedProfile && shouldPersist) {
      await persistSavedProfileReferenceSelection(savedProfile, warmPayload, {
        readObject,
        writeObject,
        now,
      });
    }
    await postInference('/ref-audio/warm', warmPayload);
    return warmPayload;
  } catch (error) {
    const target = String(payload?.ref_audio_path || payload?.sovitsKey || payload?.sovitsPath || payload?.gptKey || payload?.gptPath || '').trim();
    console.warn(`[modelSelection] ref-audio warm failed for ${target || 'unknown model selection'}: ${error.message}`);
    return null;
  }
}

export async function loadModelPair({
  voiceProfileId = '',
  gptKey = '',
  gptPath = '',
  sovitsKey = '',
  sovitsPath = '',
  ref_audio_path = '',
  aux_ref_audio_paths = [],
} = {}, {
  postInference = inferencePost,
  listTrainingAudioFiles = loadTrainingAudioFilesForExp,
  readObject = getObject,
  writeObject = uploadBuffer,
  now = () => new Date().toISOString(),
} = {}) {
  const resolvedGptKey = gptKey || gptPath;
  const resolvedSovitsKey = sovitsKey || sovitsPath;
  const warmPayload = {
    voiceProfileId,
    gptKey,
    gptPath,
    sovitsKey,
    sovitsPath,
    ref_audio_path,
    aux_ref_audio_paths,
  };

  let lastStatus = null;
  if (useGpuWorkerModels()) {
    if (resolvedSovitsKey) {
      lastStatus = await postInference('/inference/weights/sovits', { weightsPath: resolvedSovitsKey });
    }
    if (resolvedGptKey) {
      lastStatus = await postInference('/inference/weights/gpt', { weightsPath: resolvedGptKey });
    }
    const warmedReferences = await warmModelReferences(warmPayload, {
      postInference,
      listTrainingAudioFiles,
      readObject,
      writeObject,
      now,
    });
    return {
      message: 'Models loaded successfully',
      loaded: lastStatus?.loaded || {},
      ...(warmedReferences ? { warmedReferences } : {}),
    };
  }

  if (resolvedSovitsKey) {
    const { localPath } = await postInference('/models/download', { s3Key: resolvedSovitsKey });
    lastStatus = await postInference('/inference/weights/sovits', { weightsPath: localPath });
  }
  if (resolvedGptKey) {
    const { localPath } = await postInference('/models/download', { s3Key: resolvedGptKey });
    lastStatus = await postInference('/inference/weights/gpt', { weightsPath: localPath });
  }
  const warmedReferences = await warmModelReferences(warmPayload, {
    postInference,
    listTrainingAudioFiles,
    readObject,
    writeObject,
    now,
  });

  return {
    message: 'Models loaded successfully',
    loaded: lastStatus?.loaded || {},
    ...(warmedReferences ? { warmedReferences } : {}),
  };
}

export async function ensureProfileModelsLoaded(profile, {
  getStatus = inferenceGet,
  loadModels = loadModelPair,
} = {}) {
  const gptRef = String(profile?.gptKey || profile?.gptPath || '').trim();
  const sovitsRef = String(profile?.sovitsKey || profile?.sovitsPath || '').trim();

  if (!gptRef && !sovitsRef) {
    return { message: 'No model references provided', loaded: {} };
  }

  if (useGpuWorkerModels()) {
    const status = await getStatus('/inference/status');
    const loaded = status?.loaded || {};
    if (loaded.gptPath === gptRef && loaded.sovitsPath === sovitsRef) {
      return {
        message: 'Models already loaded',
        loaded,
      };
    }
  }

  return loadModels(profile);
}
