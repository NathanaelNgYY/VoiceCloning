import { spawn, execSync } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import { PYTHON_EXEC, GPT_SOVITS_ROOT, assertConfig, buildPythonEnv } from '../config.js';

const PYTHON_RUNNER = [
  '-c',
  [
    'import runpy, sys',
    'ROOT = sys.argv[1]',
    'TOOLS = sys.argv[2]',
    'GPT = sys.argv[3]',
    'SCRIPT = sys.argv[4]',
    'ARGS = sys.argv[5:]',
    'sys.path[:0] = [path for path in (GPT, TOOLS, ROOT) if path and path not in sys.path]',
    'sys.argv = [SCRIPT, *ARGS]',
    'runpy.run_path(SCRIPT, run_name="__main__")',
  ].join('; '),
];

const toolsDir = path.join(GPT_SOVITS_ROOT, 'tools');
const gptDir = path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS');

class ProcessManager extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map(); // sessionId -> { process, scriptPath }
  }

  run({ scriptPath, args = [], env = {}, sessionId }) {
    return new Promise((resolve, reject) => {
      try {
        assertConfig({ requirePython: true });
      } catch (err) {
        reject(err);
        return;
      }

      if (this.processes.has(sessionId)) {
        reject(new Error(`Process already running for session ${sessionId}`));
        return;
      }

      const child = spawn(PYTHON_EXEC, [...PYTHON_RUNNER, GPT_SOVITS_ROOT, toolsDir, gptDir, scriptPath, ...args], {
        cwd: GPT_SOVITS_ROOT,
        env: buildPythonEnv(env),
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
      if (process.platform === 'win32') {
        execSync(`taskkill /t /f /pid ${entry.process.pid}`, { stdio: 'ignore' });
      } else {
        entry.process.kill('SIGKILL');
      }
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

  hasRunningProcesses() {
    return this.processes.size > 0;
  }

  killAll() {
    const sessionIds = [...this.processes.keys()];
    for (const sessionId of sessionIds) {
      this.kill(sessionId);
    }
  }
}

export const processManager = new ProcessManager();
