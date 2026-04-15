import { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PYTHON_EXEC, GPT_SOVITS_ROOT, SCRIPTS, LOCAL_TEMP_ROOT, buildPythonEnv } from '../config.js';
import { downloadFile } from '../services/s3Sync.js';

const router = Router();

router.post('/transcribe', async (req, res) => {
  const { s3Key, language = 'auto' } = req.body;
  if (!s3Key) {
    return res.status(400).json({ error: 's3Key is required' });
  }

  const localPath = path.join(LOCAL_TEMP_ROOT, 'transcribe', `${Date.now()}_${path.basename(s3Key)}`);

  try {
    await downloadFile(s3Key, localPath);

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
        '-i', localPath,
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
  } finally {
    try { fs.unlinkSync(localPath); } catch { /* ignore */ }
  }
});

export default router;
