import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  GPT_SOVITS_ROOT,
  PYTHON_EXEC,
  SCRIPTS,
  getConfigError,
} from '../config.js';

function parseTranscriptionOutput(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep scanning for the final JSON line.
    }
  }

  throw new Error('Failed to parse transcription output');
}

export async function transcribeReferenceAudio(filePath, {
  language = 'auto',
  model = 'medium',
  timeoutMs = 180000,
} = {}) {
  const configError = getConfigError({ requirePython: true });
  if (configError) {
    throw new Error(configError);
  }
  if (!filePath) {
    throw new Error('filePath is required');
  }

  const absolutePath = path.resolve(GPT_SOVITS_ROOT, filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error('Audio file not found');
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    const args = [
      '-c',
      [
        'import runpy, sys',
        `ROOT = ${JSON.stringify(GPT_SOVITS_ROOT)}`,
        'TOOLS = ROOT + "/tools"',
        'GPT = ROOT + "/GPT_SoVITS"',
        `SCRIPT = ${JSON.stringify(SCRIPTS.transcribeSingle)}`,
        'sys.path[:0] = [path for path in (GPT, TOOLS, ROOT) if path and path not in sys.path]',
        'sys.argv = [SCRIPT, *sys.argv[1:]]',
        'runpy.run_path(SCRIPT, run_name="__main__")',
      ].join('; '),
      '-i', absolutePath,
      '-l', language,
      '-s', model,
      '-p', 'int8',
    ];

    const proc = spawn(PYTHON_EXEC, args, {
      cwd: GPT_SOVITS_ROOT,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        PATH: `${GPT_SOVITS_ROOT}${path.delimiter}${process.env.PATH || ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore cleanup failure.
      }
      finishReject(new Error(`Transcription timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('[transcribe]', data.toString().trim());
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        finishReject(new Error(stderr || `Transcription exited with code ${code}`));
        return;
      }

      try {
        finishResolve(parseTranscriptionOutput(stdout));
      } catch (error) {
        finishReject(error);
      }
    });

    proc.on('error', finishReject);
  });
}
