import { spawn, execSync } from 'child_process';
import path from 'path';
import {
  PYTHON_EXEC,
  SCRIPTS,
  GPT_SOVITS_ROOT,
  INFERENCE_HOST,
  INFERENCE_PORT,
  buildPythonEnv,
} from '../config.js';

const BASE_URL = `http://${INFERENCE_HOST}:${INFERENCE_PORT}`;
const toolsDir = path.join(GPT_SOVITS_ROOT, 'tools');
const gptDir = path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS');

const PYTHON_RUNNER = [
  '-c',
  [
    'import os,sys,runpy',
    'root=sys.argv[1]',
    'tools=sys.argv[2]',
    'gpt=sys.argv[3]',
    'script=sys.argv[4]',
    'sys.path.insert(0, root)',
    'sys.path.insert(0, tools)',
    'sys.path.insert(0, gpt)',
    'sys.argv=[script]+sys.argv[5:]',
    'runpy.run_path(script, run_name="__main__")',
  ].join(';'),
];

function buildStatus({ ready, error = null, loaded, managed }) {
  return {
    ready,
    error,
    loaded,
    managed,
  };
}

function extractErrorMessage(payload, fallback) {
  if (typeof payload === 'string') {
    return payload;
  }
  if (payload && typeof payload === 'object') {
    return payload.message || payload.detail || payload.error || fallback;
  }
  return fallback;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJsonOrText(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

class InferenceServer {
  constructor() {
    this.process = null;
    this.ready = false;
    this.startPromise = null;
    this.currentGPTWeights = '';
    this.currentSoVITSWeights = '';
  }

  getLoadedWeights() {
    return {
      gptPath: this.currentGPTWeights,
      sovitsPath: this.currentSoVITSWeights,
    };
  }

  getStatusSnapshot(error = null) {
    return buildStatus({
      ready: this.ready,
      error,
      loaded: this.getLoadedWeights(),
      managed: this.process !== null,
    });
  }

  async probeReady() {
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/docs`, {}, 2000);
      this.ready = response.status > 0;
      return this.ready;
    } catch {
      this.ready = false;
      return false;
    }
  }

  async getStatus() {
    await this.probeReady();
    return this.getStatusSnapshot();
  }

  async start() {
    if (await this.probeReady()) {
      return this.getStatusSnapshot();
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    if (this.process) {
      throw new Error('Inference server is already running');
    }

    this.startPromise = new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.ready = true;
        resolve(this.getStatusSnapshot());
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.process = null;
        this.ready = false;
        reject(error);
      };

      this.process = spawn(PYTHON_EXEC, [
        ...PYTHON_RUNNER,
        GPT_SOVITS_ROOT,
        toolsDir,
        gptDir,
        SCRIPTS.apiServer,
        '-a', INFERENCE_HOST,
        '-p', String(INFERENCE_PORT),
      ], {
        cwd: GPT_SOVITS_ROOT,
        env: buildPythonEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        finishReject(new Error('Inference server startup timed out'));
      }, 120_000);

      const onData = (data) => {
        const text = data.toString();
        console.log('[gpu-worker][inference]', text.trim());
        if (text.includes('Uvicorn running') || text.includes('Application startup complete')) {
          finishResolve();
        }
      };

      this.process.stdout.on('data', onData);
      this.process.stderr.on('data', onData);

      this.process.on('error', (err) => {
        finishReject(err);
      });

      this.process.on('close', () => {
        clearTimeout(timeout);
        this.process = null;
        this.ready = false;
      });
    }).finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  stop() {
    if (!this.process) {
      this.ready = false;
      return buildStatus({
        ready: false,
        error: null,
        loaded: { gptPath: '', sovitsPath: '' },
        managed: false,
      });
    }

    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /t /f /pid ${this.process.pid}`, { stdio: 'ignore' });
      } else {
        this.process.kill('SIGKILL');
      }
    } catch {
      try {
        this.process.kill('SIGKILL');
      } catch {
        // ignore
      }
    }

    this.process = null;
    this.ready = false;
    this.currentGPTWeights = '';
    this.currentSoVITSWeights = '';

    return this.getStatusSnapshot();
  }

  async requestJson(endpoint, { params = {}, method = 'GET', body, timeoutMs = 120000 } = {}) {
    const url = new URL(endpoint, `${BASE_URL}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetchWithTimeout(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }, timeoutMs);

    const payload = await parseJsonOrText(response);
    if (!response.ok) {
      throw new Error(extractErrorMessage(payload, `Inference server returned ${response.status}`));
    }

    return payload;
  }

  async setGPTWeights(weightsPath) {
    await this.start();
    await this.requestJson('/set_gpt_weights', {
      params: { weights_path: weightsPath },
      timeoutMs: 120000,
    });
    this.currentGPTWeights = weightsPath;
    return this.getStatusSnapshot();
  }

  async setSoVITSWeights(weightsPath) {
    await this.start();
    await this.requestJson('/set_sovits_weights', {
      params: { weights_path: weightsPath },
      timeoutMs: 120000,
    });
    this.currentSoVITSWeights = weightsPath;
    return this.getStatusSnapshot();
  }

  async synthesize(params, { timeoutMs = 180000 } = {}) {
    const response = await fetchWithTimeout(`${BASE_URL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }, timeoutMs);

    if (!response.ok) {
      const payload = await parseJsonOrText(response);
      throw new Error(extractErrorMessage(payload, `Inference server returned ${response.status}`));
    }

    const audio = await response.arrayBuffer();
    return Buffer.from(audio);
  }
}

export const inferenceServer = new InferenceServer();
