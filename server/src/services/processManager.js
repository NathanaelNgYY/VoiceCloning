import { spawn, execSync } from 'child_process';
import { EventEmitter } from 'events';
import { PYTHON_EXEC, GPT_SOVITS_ROOT } from '../config.js';

class ProcessManager extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map(); // sessionId -> { process, scriptPath }
  }

  run({ scriptPath, args = [], env = {}, sessionId }) {
    return new Promise((resolve, reject) => {
      if (this.processes.has(sessionId)) {
        reject(new Error(`Process already running for session ${sessionId}`));
        return;
      }

      const mergedEnv = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        PATH: `${GPT_SOVITS_ROOT};${process.env.PATH}`,
        ...env,
      };

      const child = spawn(PYTHON_EXEC, [scriptPath, ...args], {
        cwd: GPT_SOVITS_ROOT,
        env: mergedEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.processes.set(sessionId, { process: child, scriptPath });

      child.stdout.on('data', (data) => {
        const text = data.toString();
        this.emit('log', { sessionId, stream: 'stdout', data: text });
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        this.emit('log', { sessionId, stream: 'stderr', data: text });
      });

      child.on('error', (err) => {
        this.processes.delete(sessionId);
        this.emit('exit', { sessionId, code: -1 });
        reject(err);
      });

      child.on('close', (code) => {
        this.processes.delete(sessionId);
        this.emit('exit', { sessionId, code });
        if (code === 0) {
          resolve(code);
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });
    });
  }

  kill(sessionId) {
    const entry = this.processes.get(sessionId);
    if (!entry) return false;

    try {
      execSync(`taskkill /t /f /pid ${entry.process.pid}`, { stdio: 'ignore' });
    } catch {
      // Process may have already exited
      try {
        entry.process.kill('SIGKILL');
      } catch { /* ignore */ }
    }

    this.processes.delete(sessionId);
    return true;
  }

  isRunning(sessionId) {
    return this.processes.has(sessionId);
  }
}

export const processManager = new ProcessManager();
