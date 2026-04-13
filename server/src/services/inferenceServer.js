import { spawn, execSync } from 'child_process';
import path from 'path';
import axios from 'axios';
import { PYTHON_EXEC, SCRIPTS, GPT_SOVITS_ROOT, INFERENCE_HOST, INFERENCE_PORT, assertConfig } from '../config.js';

const BASE_URL = `http://${INFERENCE_HOST}:${INFERENCE_PORT}`;
const toolsDir = path.join(GPT_SOVITS_ROOT, 'tools');
const gptDir = path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS');
const pathListSeparator = process.platform === 'win32' ? ';' : ':';

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

class InferenceServer {
  constructor() {
    this.process = null;
    this.ready = false;
    this.currentGPTWeights = '';
    this.currentSoVITSWeights = '';
  }

  async start() {
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
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          PATH: `${GPT_SOVITS_ROOT}${pathListSeparator}${process.env.PATH || ''}`,
          PYTHONPATH: process.env.PYTHONPATH
            ? `${GPT_SOVITS_ROOT}${pathListSeparator}${process.env.PYTHONPATH}`
            : GPT_SOVITS_ROOT,
        },
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

  stop() {
    if (!this.process) return;
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /t /f /pid ${this.process.pid}`, { stdio: 'ignore' });
      } else {
        this.process.kill('SIGKILL');
      }
    } catch {
      try { this.process.kill('SIGKILL'); } catch {}
    }
    this.process = null;
    this.ready = false;
    this.currentGPTWeights = '';
    this.currentSoVITSWeights = '';
  }

  async setGPTWeights(weightsPath) {
    const res = await axios.get(`${BASE_URL}/set_gpt_weights`, {
      params: { weights_path: weightsPath },
      timeout: 120000,
    });
    this.currentGPTWeights = weightsPath;
    return res.data;
  }

  async setSoVITSWeights(weightsPath) {
    const res = await axios.get(`${BASE_URL}/set_sovits_weights`, {
      params: { weights_path: weightsPath },
      timeout: 120000,
    });
    this.currentSoVITSWeights = weightsPath;
    return res.data;
  }

  async synthesize(params, { timeoutMs = 180000 } = {}) {
    try {
      const res = await axios.post(`${BASE_URL}/tts`, params, {
        responseType: 'arraybuffer',
        timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      });
      return Buffer.from(res.data);
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        throw new Error(`Inference request timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      if (err.response?.data) {
        const text = Buffer.from(err.response.data).toString('utf-8');
        try {
          const json = JSON.parse(text);
          throw new Error(json.message || json.detail || json.error || text);
        } catch (parseErr) {
          if (parseErr.message !== text) throw parseErr;
          throw new Error(text);
        }
      }
      throw err;
    }
  }

  isReady() {
    return this.ready && this.process !== null;
  }

  getLoadedWeights() {
    return {
      gptPath: this.currentGPTWeights,
      sovitsPath: this.currentSoVITSWeights,
    };
  }
}

export const inferenceServer = new InferenceServer();
