import { spawn, execSync } from 'child_process';
import axios from 'axios';
import { PYTHON_EXEC, SCRIPTS, GPT_SOVITS_ROOT, INFERENCE_HOST, INFERENCE_PORT } from '../config.js';

const BASE_URL = `http://${INFERENCE_HOST}:${INFERENCE_PORT}`;

class InferenceServer {
  constructor() {
    this.process = null;
    this.ready = false;
  }

  async start() {
    if (this.process) {
      throw new Error('Inference server is already running');
    }

    return new Promise((resolve, reject) => {
      this.process = spawn(PYTHON_EXEC, [
        SCRIPTS.apiServer,
        '-a', INFERENCE_HOST,
        '-p', String(INFERENCE_PORT),
      ], {
        cwd: GPT_SOVITS_ROOT,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          // ffmpeg.exe lives in GPT_SOVITS_ROOT, add to PATH
          PATH: `${GPT_SOVITS_ROOT};${process.env.PATH}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        reject(new Error('Inference server startup timed out'));
      }, 120_000);

      const onData = (data) => {
        const text = data.toString();
        console.log('[inference]', text.trim());
        if (text.includes('Uvicorn running') || text.includes('Application startup complete')) {
          clearTimeout(timeout);
          this.ready = true;
          resolve();
        }
      };

      this.process.stdout.on('data', onData);
      this.process.stderr.on('data', onData);

      this.process.on('error', (err) => {
        clearTimeout(timeout);
        this.process = null;
        this.ready = false;
        reject(err);
      });

      this.process.on('close', (code) => {
        clearTimeout(timeout);
        this.process = null;
        this.ready = false;
      });
    });
  }

  stop() {
    if (!this.process) return;
    try {
      execSync(`taskkill /t /f /pid ${this.process.pid}`, { stdio: 'ignore' });
    } catch {
      try { this.process.kill('SIGKILL'); } catch { /* ignore */ }
    }
    this.process = null;
    this.ready = false;
  }

  async setGPTWeights(weightsPath) {
    const res = await axios.get(`${BASE_URL}/set_gpt_weights`, {
      params: { weights_path: weightsPath },
    });
    return res.data;
  }

  async setSoVITSWeights(weightsPath) {
    const res = await axios.get(`${BASE_URL}/set_sovits_weights`, {
      params: { weights_path: weightsPath },
    });
    return res.data;
  }

  async synthesize(params) {
    try {
      const res = await axios.post(`${BASE_URL}/tts`, params, {
        responseType: 'arraybuffer',
        headers: { 'Content-Type': 'application/json' },
      });
      return Buffer.from(res.data);
    } catch (err) {
      // Decode the arraybuffer error response to get the actual error message
      if (err.response?.data) {
        const text = Buffer.from(err.response.data).toString('utf-8');
        try {
          const json = JSON.parse(text);
          throw new Error(json.message || json.detail || text);
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
}

export const inferenceServer = new InferenceServer();
