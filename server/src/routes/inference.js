import { Router } from 'express';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  WEIGHT_DIRS,
  GPT_SOVITS_ROOT,
  DATA_ROOT,
  PYTHON_EXEC,
  SCRIPTS,
  REF_AUDIO_DIR,
  buildPythonEnv,
  getConfigError,
  isLocalInferenceMode,
} from '../config.js';
import { inferenceServer } from '../services/inferenceServer.js';
import { sseManager } from '../services/sseManager.js';
import { synthesizeLongText, synthesizeLongTextStreaming, cancelSession, getSessionFinalPath } from '../services/longTextInference.js';
import { inferenceState } from '../services/inferenceState.js';
import { isPathInside, isSafePathSegment } from '../utils/paths.js';
import { isS3Mode, generatePresignedGetUrl, listObjects, getObject } from '../services/s3Storage.js';

const router = Router();

function getInferenceConfigError() {
  return getConfigError({ requirePython: isLocalInferenceMode() });
}

async function resolveRefAudioPaths(refPath, auxPaths) {
  if (!isS3Mode()) return { refPath, auxPaths };
  const { gpuWorkerClient } = await import('../services/gpuWorkerClient.js');
  const { localPath } = await gpuWorkerClient.downloadRefAudio(refPath);
  const resolvedAux = await Promise.all(
    auxPaths.map(async (p) => {
      const { localPath: lp } = await gpuWorkerClient.downloadRefAudio(p);
      return lp;
    })
  );
  return { refPath: localPath, auxPaths: resolvedAux };
}

router.get('/models', async (_req, res) => {
  if (isS3Mode()) {
    try {
      const [gptObjects, sovitsObjects] = await Promise.all([
        listObjects('models/user-models/gpt/'),
        listObjects('models/user-models/sovits/'),
      ]);
      const gpt = gptObjects
        .filter(o => o.key.endsWith('.ckpt'))
        .map(o => ({ name: path.basename(o.key), key: o.key }));
      const sovits = sovitsObjects
        .filter(o => o.key.endsWith('.pth'))
        .map(o => ({ name: path.basename(o.key), key: o.key }));
      return res.json({ gpt, sovits });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  const configError = getConfigError({ requireLocalRuntime: true });
  if (configError) {
    return res.status(500).json({ error: configError });
  }
  try {
    const gptFiles = fs.existsSync(WEIGHT_DIRS.gpt)
      ? fs.readdirSync(WEIGHT_DIRS.gpt).filter(f => f.endsWith('.ckpt'))
      : [];
    const sovitsFiles = fs.existsSync(WEIGHT_DIRS.sovits)
      ? fs.readdirSync(WEIGHT_DIRS.sovits).filter(f => f.endsWith('.pth'))
      : [];
    res.json({
      gpt: gptFiles.map(f => ({ name: f, path: path.join(WEIGHT_DIRS.gpt, f) })),
      sovits: sovitsFiles.map(f => ({ name: f, path: path.join(WEIGHT_DIRS.sovits, f) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/models/select', async (req, res) => {
  if (isS3Mode()) {
    const { gptKey, sovitsKey, gptPath, sovitsPath } = req.body;
    const resolvedGptKey = gptKey || gptPath;
    const resolvedSovitsKey = sovitsKey || sovitsPath;

    try {
      if (!await inferenceServer.checkReady()) {
        await inferenceServer.start();
      }

      // In S3 mode, download weights via GPU Worker, then load
      const { gpuWorkerClient } = await import('../services/gpuWorkerClient.js');

      if (resolvedSovitsKey) {
        const { localPath } = await gpuWorkerClient.downloadModel(resolvedSovitsKey);
        await inferenceServer.setSoVITSWeights(localPath);
      }
      if (resolvedGptKey) {
        const { localPath } = await gpuWorkerClient.downloadModel(resolvedGptKey);
        await inferenceServer.setGPTWeights(localPath);
      }

      return res.json({
        message: 'Models loaded successfully',
        loaded: inferenceServer.getLoadedWeights(),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  const { gptPath, sovitsPath } = req.body;
  const configError = getConfigError({ requirePython: true });
  if (configError) {
    return res.status(500).json({ error: configError });
  }
  try {
    if (!await inferenceServer.checkReady()) {
      await inferenceServer.start();
    }
    if (sovitsPath) {
      await inferenceServer.setSoVITSWeights(sovitsPath);
    }
    if (gptPath) {
      await inferenceServer.setGPTWeights(gptPath);
    }
    res.json({
      message: 'Models loaded successfully',
      loaded: inferenceServer.getLoadedWeights(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/inference', async (req, res) => {
  const configError = getInferenceConfigError();
  if (configError) {
    return res.status(500).json({ error: configError });
  }

  const {
    text,
    text_lang = 'en',
    ref_audio_path,
    prompt_text = '',
    prompt_lang = 'en',
    aux_ref_audio_paths = [],
    top_k = 5,
    top_p = 0.85,
    temperature = 0.7,
    repetition_penalty = 1.35,
    speed_factor = 1.0,
    seed = -1,
  } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (!ref_audio_path) {
    return res.status(400).json({ error: 'ref_audio_path is required' });
  }

  try {
    if (!await inferenceServer.checkReady()) {
      return res.status(503).json({ error: 'Inference server is not running. Load models first.' });
    }

    const resolved = await resolveRefAudioPaths(ref_audio_path, aux_ref_audio_paths);

    const { audioBuffer, chunks } = await synthesizeLongText({
      text,
      text_lang,
      ref_audio_path: resolved.refPath,
      prompt_text,
      prompt_lang,
      aux_ref_audio_paths: resolved.auxPaths,
      top_k,
      top_p,
      temperature,
      repetition_penalty,
      speed_factor,
      seed,
    }, {
      maxChunkLength: 280,
      maxSentencesPerChunk: 3,
      chunkJoinPauseMs: 120,
      retryCount: 2,
    });

    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': audioBuffer.length,
      'X-Chunk-Count': String(chunks.length),
      'X-Chunk-Retries': String(chunks.reduce((sum, chunk) => sum + Math.max(0, chunk.attempts - 1), 0)),
    });
    res.send(audioBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Streaming inference endpoints ──

router.post('/inference/generate', async (req, res) => {
  const configError = getInferenceConfigError();
  if (configError) {
    return res.status(500).json({ error: configError });
  }

  const {
    text,
    text_lang = 'en',
    ref_audio_path,
    prompt_text = '',
    prompt_lang = 'en',
    aux_ref_audio_paths = [],
    top_k = 5,
    top_p = 0.85,
    temperature = 0.7,
    repetition_penalty = 1.35,
    speed_factor = 1.0,
    seed = -1,
  } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (!ref_audio_path) {
    return res.status(400).json({ error: 'ref_audio_path is required' });
  }

  if (!await inferenceServer.checkReady()) {
    return res.status(503).json({ error: 'Inference server is not running. Load models first.' });
  }
  if (['waiting', 'generating'].includes(inferenceState.getState().status)) {
    return res.status(409).json({ error: 'Another generation is already running on this instance' });
  }

  let resolvedRefPath = ref_audio_path;
  let resolvedAuxPaths = aux_ref_audio_paths;
  try {
    const resolved = await resolveRefAudioPaths(ref_audio_path, aux_ref_audio_paths);
    resolvedRefPath = resolved.refPath;
    resolvedAuxPaths = resolved.auxPaths;
  } catch (err) {
    return res.status(500).json({ error: `Failed to resolve reference audio: ${err.message}` });
  }

  const sessionId = crypto.randomUUID();
  inferenceState.resetForNewSession({
    sessionId,
    params: {
      text,
      text_lang,
      ref_audio_path: resolvedRefPath,
      prompt_text,
      prompt_lang,
      aux_ref_audio_paths: resolvedAuxPaths,
      top_k,
      top_p,
      temperature,
      repetition_penalty,
      speed_factor,
      seed,
    },
  });
  sseManager.prepareSession(sessionId);
  res.json({ sessionId });

  // Wait for the SSE client to connect, then start streaming synthesis
  sseManager.waitForClient(sessionId).then(() => {
    synthesizeLongTextStreaming(sessionId, {
      text,
      text_lang,
      ref_audio_path: resolvedRefPath,
      prompt_text,
      prompt_lang,
      aux_ref_audio_paths: resolvedAuxPaths,
      top_k,
      top_p,
      temperature,
      repetition_penalty,
      speed_factor,
      seed,
    }, {
      maxChunkLength: 280,
      maxSentencesPerChunk: 3,
      chunkJoinPauseMs: 120,
      retryCount: 2,
    });
  }).catch((err) => {
    console.error(`[inference/generate] SSE client timeout for ${sessionId}:`, err.message);
  });
});

router.get('/inference/progress/:sessionId', (req, res) => {
  sseManager.addClient(req.params.sessionId, res);
});

router.get('/inference/result/:sessionId', async (req, res) => {
  if (isS3Mode()) {
    try {
      const key = `audio/output/${req.params.sessionId}/final.wav`;
      const url = await generatePresignedGetUrl(key);
      return res.json({ url });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  const finalPath = getSessionFinalPath(req.params.sessionId);
  if (!fs.existsSync(finalPath)) {
    return res.status(404).json({ error: 'Result not ready or session not found' });
  }
  const stat = fs.statSync(finalPath);
  res.set({ 'Content-Type': 'audio/wav', 'Content-Length': stat.size });
  fs.createReadStream(finalPath).pipe(res);
});

router.get('/inference/current', (_req, res) => {
  res.json(inferenceState.getState());
});

router.post('/inference/cancel', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  const cancelled = cancelSession(sessionId);
  if (cancelled) {
    inferenceState.setError('Generation cancelled by user', 'cancelled');
  }
  res.json({ cancelled });
});

router.post('/inference/stop', async (_req, res) => {
  try {
    await inferenceServer.stop();
    res.json({ message: 'Inference server stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transcribe - auto-transcribe reference audio
router.post('/transcribe', async (req, res) => {
  const { filePath, language = 'auto' } = req.body;
  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  if (isS3Mode()) {
    try {
      const { gpuWorkerClient } = await import('../services/gpuWorkerClient.js');
      const result = await gpuWorkerClient.transcribe(filePath, language);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  const configError = getConfigError({ requirePython: true });
  if (configError) {
    return res.status(503).json({ error: configError });
  }

  const absolutePath = path.resolve(GPT_SOVITS_ROOT, filePath);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: 'Audio file not found' });
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const args = [
        '-c',
        [
          'import runpy, sys',
          `ROOT = ${JSON.stringify(GPT_SOVITS_ROOT)}`,
          `TOOLS = ROOT + "/tools"`,
          `GPT = ROOT + "/GPT_SoVITS"`,
          `SCRIPT = ${JSON.stringify(SCRIPTS.transcribeSingle)}`,
          'sys.path[:0] = [path for path in (GPT, TOOLS, ROOT) if path and path not in sys.path]',
          'sys.argv = [SCRIPT, *sys.argv[1:]]',
          'runpy.run_path(SCRIPT, run_name="__main__")',
        ].join('; '),
        '-i', absolutePath,
        '-l', language,
        '-s', 'medium',
        '-p', 'int8',
      ];

      const proc = spawn(PYTHON_EXEC, args, {
        cwd: GPT_SOVITS_ROOT,
        env: buildPythonEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        console.log('[transcribe]', d.toString().trim());
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(stderr || `Transcription exited with code ${code}`));
        }
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        try {
          resolve(JSON.parse(lastLine));
        } catch {
          reject(new Error('Failed to parse transcription output'));
        }
      });

      proc.on('error', reject);
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/inference/status', async (_req, res) => {
  const configError = getInferenceConfigError();
  if (configError) {
    return res.json({
      mode: isLocalInferenceMode() ? 'local' : 'remote',
      ready: false,
      error: configError,
      loaded: inferenceServer.getLoadedWeights(),
      managed: false,
    });
  }

  const status = await inferenceServer.getStatus();
  res.json(status);
});

// ── Training audio browser endpoints ──

router.get('/training-audio/file/:expName/:filename', async (req, res) => {
  const { expName, filename } = req.params;
  if (!isSafePathSegment(expName) || !isSafePathSegment(filename)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  if (isS3Mode()) {
    try {
      const key = `training/datasets/${expName}/denoised/${filename}`;
      const url = await generatePresignedGetUrl(key);
      return res.json({ url });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  if (!DATA_ROOT) {
    return res.status(503).json({ error: 'Training data directory is not configured' });
  }
  const filePath = path.join(DATA_ROOT, expName, 'denoised', filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  const stat = fs.statSync(filePath);
  res.set({ 'Content-Type': 'audio/wav', 'Content-Length': stat.size });
  fs.createReadStream(filePath).pipe(res);
});

router.get('/ref-audio', async (req, res) => {
  const filePath = String(req.query.filePath || '');
  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  if (isS3Mode()) {
    try {
      const url = await generatePresignedGetUrl(filePath);
      return res.json({ url });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  if (!REF_AUDIO_DIR) {
    return res.status(503).json({ error: 'Reference audio directory is not configured' });
  }
  const resolvedPath = path.resolve(GPT_SOVITS_ROOT, filePath);
  if (!isPathInside(resolvedPath, REF_AUDIO_DIR)) {
    return res.status(400).json({ error: 'Invalid reference audio path' });
  }
  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Reference audio not found' });
  }
  const stat = fs.statSync(resolvedPath);
  res.type(path.extname(resolvedPath));
  res.set({ 'Content-Length': stat.size });
  fs.createReadStream(resolvedPath).pipe(res);
});

router.get('/training-audio/:expName', async (req, res) => {
  const { expName } = req.params;
  if (!isSafePathSegment(expName)) {
    return res.status(400).json({ error: 'Invalid experiment name' });
  }

  if (isS3Mode()) {
    try {
      const denoisedPrefix = `training/datasets/${expName}/denoised/`;
      const objects = await listObjects(denoisedPrefix);
      const wavFiles = objects
        .filter(o => o.key.endsWith('.wav'))
        .map(o => path.basename(o.key))
        .sort();

      // Try to parse ASR transcript from S3
      const transcriptMap = new Map();
      try {
        const asrKey = `training/datasets/${expName}/asr/denoised.list`;
        const asrBuffer = await getObject(asrKey);
        const lines = asrBuffer.toString('utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          const parts = line.split('|');
          if (parts.length >= 4) {
            const fname = path.basename(parts[0]);
            transcriptMap.set(fname, { transcript: parts.slice(3).join('|'), lang: parts[2] });
          }
        }
      } catch { /* ASR file may not exist yet */ }

      const files = wavFiles.map(filename => {
        const info = transcriptMap.get(filename) || {};
        return {
          filename,
          key: `${denoisedPrefix}${filename}`,
          transcript: info.transcript || '',
          lang: info.lang || '',
        };
      });
      return res.json({ expName, files });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode — original behavior
  if (!DATA_ROOT) {
    return res.status(503).json({ error: 'Training data directory is not configured' });
  }

  const denoisedDir = path.join(DATA_ROOT, expName, 'denoised');
  if (!fs.existsSync(denoisedDir)) {
    return res.json({ expName, files: [] });
  }

  const asrPath = path.join(DATA_ROOT, expName, 'asr', 'denoised.list');
  const transcriptMap = new Map();
  if (fs.existsSync(asrPath)) {
    const lines = fs.readFileSync(asrPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length >= 4) {
        const fname = path.basename(parts[0]);
        transcriptMap.set(fname, { transcript: parts.slice(3).join('|'), lang: parts[2] });
      }
    }
  }

  try {
    const wavFiles = fs.readdirSync(denoisedDir).filter(f => f.endsWith('.wav')).sort();
    const files = wavFiles.map(filename => {
      const info = transcriptMap.get(filename) || {};
      return {
        filename,
        path: path.join(denoisedDir, filename),
        transcript: info.transcript || '',
        lang: info.lang || '',
      };
    });
    res.json({ expName, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
