import path from 'path';
import { getObject, listObjects } from './s3.js';
import { gpuGet, inferenceGet, inferencePost } from './gpuWorker.js';
import { useGpuWorkerArtifacts } from './artifacts.js';
import { isSafePathSegment } from './paths.js';

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

function scoreReferenceClip(file) {
  const filename = file?.filename || getBasename(file?.path);
  const ext = extensionOf(filename);
  const lang = normalizeLang(file?.lang);

  let score = transcriptScore(file?.transcript);

  if (GOOD_AUDIO_EXTENSIONS.has(ext)) score += 18;
  else if (OK_AUDIO_EXTENSIONS.has(ext)) score += 6;

  if (lang === 'en' || lang === 'eng') score += 14;
  else if (lang === 'auto' || !lang) score += 3;

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

  return wavFiles.map((filename) => {
    const info = transcriptMap.get(filename) || {};
    return {
      filename,
      key: `${denoisedPrefix}${filename}`,
      path: `${denoisedPrefix}${filename}`,
      transcript: info.transcript || '',
      lang: info.lang || '',
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

async function resolveReferenceWarmPayload({
  gptKey = '',
  gptPath = '',
  sovitsKey = '',
  sovitsPath = '',
  ref_audio_path = '',
  aux_ref_audio_paths = [],
} = {}) {
  const explicit = normalizeReferenceWarmPayload({ ref_audio_path, aux_ref_audio_paths });
  if (explicit) {
    return explicit;
  }

  const expName = extractExpNameFromModelRef(sovitsKey || sovitsPath || gptKey || gptPath);
  if (!expName) {
    return null;
  }

  const files = await loadTrainingAudioFilesForExp(expName);
  const selection = chooseBestReferenceSet(files);
  if (!selection.primary) {
    return null;
  }

  return normalizeReferenceWarmPayload({
    ref_audio_path: selection.primary.path,
    aux_ref_audio_paths: selection.aux.map((file) => file.path),
  });
}

async function warmModelReferences(payload) {
  try {
    const normalized = await resolveReferenceWarmPayload(payload);
    if (!normalized) {
      return null;
    }
    return await inferencePost('/ref-audio/warm', normalized);
  } catch (error) {
    const target = String(payload?.ref_audio_path || payload?.sovitsKey || payload?.sovitsPath || payload?.gptKey || payload?.gptPath || '').trim();
    console.warn(`[modelSelection] ref-audio warm failed for ${target || 'unknown model selection'}: ${error.message}`);
    return null;
  }
}

export async function loadModelPair({
  gptKey = '',
  gptPath = '',
  sovitsKey = '',
  sovitsPath = '',
  ref_audio_path = '',
  aux_ref_audio_paths = [],
} = {}) {
  const resolvedGptKey = gptKey || gptPath;
  const resolvedSovitsKey = sovitsKey || sovitsPath;
  const warmPayload = {
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
      lastStatus = await inferencePost('/inference/weights/sovits', { weightsPath: resolvedSovitsKey });
    }
    if (resolvedGptKey) {
      lastStatus = await inferencePost('/inference/weights/gpt', { weightsPath: resolvedGptKey });
    }
    const warmedReferences = await warmModelReferences(warmPayload);
    return {
      message: 'Models loaded successfully',
      loaded: lastStatus?.loaded || {},
      ...(warmedReferences ? { warmedReferences } : {}),
    };
  }

  if (resolvedSovitsKey) {
    const { localPath } = await inferencePost('/models/download', { s3Key: resolvedSovitsKey });
    lastStatus = await inferencePost('/inference/weights/sovits', { weightsPath: localPath });
  }
  if (resolvedGptKey) {
    const { localPath } = await inferencePost('/models/download', { s3Key: resolvedGptKey });
    lastStatus = await inferencePost('/inference/weights/gpt', { weightsPath: localPath });
  }
  const warmedReferences = await warmModelReferences(warmPayload);

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
