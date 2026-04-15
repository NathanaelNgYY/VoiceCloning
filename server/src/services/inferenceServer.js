import { spawn, execSync } from 'child_process';
import path from 'path';
import axios from 'axios';
import {
  PYTHON_EXEC,
  SCRIPTS,
  GPT_SOVITS_ROOT,
  INFERENCE_HOST,
  INFERENCE_PORT,
  assertConfig,
  buildPythonEnv,
  isRemoteInferenceMode,
} from '../config.js';
import { gpuWorkerClient } from './gpuWorkerClient.js';

const LOCAL_BASE_URL = `http://${INFERENCE_HOST}:${INFERENCE_PORT}`;
const toolsDir = GPT_SOVITS_ROOT ? path.join(GPT_SOVITS_ROOT, 'tools') : '';
const gptDir = GPT_SOVITS_ROOT ? path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS') : '';

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

function parseErrorResponse(data) {
  if (!data) {
    return null;
  }

  if (typeof data === 'string') {
    return data;
  }

  if (typeof data === 'object' && !Buffer.isBuffer(data) && !ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer)) {
    return data.message || data.detail || data.error || JSON.stringify(data);
  }

  const text = Buffer.isBuffer(data)
    ? data.toString('utf-8')
    : Buffer.from(data).toString('utf-8');

  try {
    const json = JSON.parse(text);
    return json.message || json.detail || json.error || text;
  } catch {
    return text;
  }
}

function normalizeRequestError(err, timeoutMs) {
  if (err.code === 'ECONNABORTED') {
    return new Error(`Inference request timed out after ${Math.round(timeoutMs / 1000)}s`);
  }

  const message = parseErrorResponse(err.response?.data);
  if (message) {
    return new Error(message);
  }

  return err;
}

class InferenceServer {
  constructor() {
    this.process = null;
    this.ready = false;
    this.currentGPTWeights = '';
    this.currentSoVITSWeights = '';
  }

  syncLoadedWeights(loaded = {}) {
    if (typeof loaded.gptPath === 'string') {
      this.currentGPTWeights = loaded.gptPath;
    }
    if (typeof loaded.sovitsPath === 'string') {
      this.currentSoVITSWeights = loaded.sovitsPath;
    }
  }

  syncRemoteStatus(status = {}) {
    this.ready = Boolean(status.ready);
    this.syncLoadedWeights(status.loaded);
  }

  async startLocal() {
    if (this.process) {
      throw new Error('Inference server is already running');
    }

    assertConfig({ requirePython: true });

    return new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.ready = true;
        resolve();
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
        console.log('[inference]', text.trim());
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
    });
  }

  async startRemote() {
    const status = await gpuWorkerClient.startInference();
    this.syncRemoteStatus(status);
    if (!this.ready) {
      throw new Error(status.error || 'Remote inference server did not become ready');
    }
  }

  async start() {
    if (isRemoteInferenceMode()) {
      await this.startRemote();
      return;
    }

    await this.startLocal();
  }

  stopLocal() {
    if (!this.process) return;
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
  }

  async stop() {
    if (isRemoteInferenceMode()) {
      try {
        await gpuWorkerClient.stopInference();
      } finally {
        this.process = null;
        this.ready = false;
        this.currentGPTWeights = '';
        this.currentSoVITSWeights = '';
      }
      return;
    }

    this.stopLocal();
  }

  async setGPTWeights(weightsPath) {
    if (isRemoteInferenceMode()) {
      const data = await gpuWorkerClient.setGPTWeights(weightsPath);
      this.syncRemoteStatus(data);
      if (!this.currentGPTWeights) {
        this.currentGPTWeights = weightsPath;
      }
      return data;
    }

    const res = await axios.get(`${LOCAL_BASE_URL}/set_gpt_weights`, {
      params: { weights_path: weightsPath },
      timeout: 120000,
    });
    this.currentGPTWeights = weightsPath;
    return res.data;
  }

  async setSoVITSWeights(weightsPath) {
    if (isRemoteInferenceMode()) {
      const data = await gpuWorkerClient.setSoVITSWeights(weightsPath);
      this.syncRemoteStatus(data);
      if (!this.currentSoVITSWeights) {
        this.currentSoVITSWeights = weightsPath;
      }
      return data;
    }

    const res = await axios.get(`${LOCAL_BASE_URL}/set_sovits_weights`, {
      params: { weights_path: weightsPath },
      timeout: 120000,
    });
    this.currentSoVITSWeights = weightsPath;
    return res.data;
  }

  async synthesize(params, { timeoutMs = 180000 } = {}) {
    try {
      if (isRemoteInferenceMode()) {
        return await gpuWorkerClient.synthesize(params, { timeoutMs });
      }

      const res = await axios.post(`${LOCAL_BASE_URL}/tts`, params, {
        responseType: 'arraybuffer',
        timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      });
      return Buffer.from(res.data);
    } catch (err) {
      throw normalizeRequestError(err, timeoutMs);
    }
  }

  async checkReady() {
    if (isRemoteInferenceMode()) {
      const status = await this.getStatus();
      return Boolean(status.ready);
    }

    return this.isReady();
  }

  async getStatus() {
    if (isRemoteInferenceMode()) {
      try {
        const status = await gpuWorkerClient.getInferenceStatus();
        this.syncRemoteStatus(status);
        return {
          mode: 'remote',
          ready: this.ready,
          error: status.error || null,
          loaded: this.getLoadedWeights(),
          managed: status.managed ?? true,
        };
      } catch (err) {
        this.ready = false;
        return {
          mode: 'remote',
          ready: false,
          error: err.message,
          loaded: this.getLoadedWeights(),
          managed: false,
        };
      }
    }

    return {
      mode: 'local',
      ready: this.isReady(),
      error: null,
      loaded: this.getLoadedWeights(),
      managed: this.process !== null,
    };
  }

  isReady() {
    return isRemoteInferenceMode() ? this.ready : this.ready && this.process !== null;
  }

  getLoadedWeights() {
    return {
      gptPath: this.currentGPTWeights,
      sovitsPath: this.currentSoVITSWeights,
    };
  }
}

export const inferenceServer = new InferenceServer();
