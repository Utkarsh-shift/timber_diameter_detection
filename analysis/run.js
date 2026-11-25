// Starts the Python analysis service, creating the virtualenv and installing dependencies on first use.
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const win = process.platform === 'win32';
const venvPy = path.join(dir, '.venv', win ? 'Scripts/python.exe' : 'bin/python');

function sys(cmd, args) { return spawnSync(cmd, args, { cwd: dir, stdio: 'inherit' }); }

if (!fs.existsSync(venvPy)) {
  const base = ['python', 'python3', 'py'].find((c) => spawnSync(c, ['--version']).status === 0);
  if (!base) { console.error('Python 3.10+ is required for the analysis service.'); process.exit(1); }
  console.log('Creating analysis/.venv …');
  if (sys(base, ['-m', 'venv', '.venv']).status !== 0) process.exit(1);
}
const have = spawnSync(venvPy, ['-c', 'import cv2, fastapi, uvicorn, scipy, multipart, sklearn, joblib'], { cwd: dir }).status === 0;
if (!have) {
  console.log('Installing Python dependencies …');
  if (sys(venvPy, ['-m', 'pip', 'install', '-q', '-r', 'requirements.txt']).status !== 0) process.exit(1);
}
if (process.argv.includes('--setup')) process.exit(0);

// optional TimberVision worker (needs analysis/.venv-tv and the downloaded weights; see analysis/timbervision/README.md)
const tvPy = path.join(dir, '.venv-tv', win ? 'Scripts/python.exe' : 'bin/python');
let tv = null;
if (fs.existsSync(tvPy) && fs.existsSync(path.join(dir, 'timbervision', 'yolov8l-1024-seg.pt'))) {
  tv = spawn(tvPy, ['-m', 'uvicorn', 'worker:app', '--port', process.env.TIMBERVISION_PORT || '5001', '--log-level', 'warning'], { cwd: path.join(dir, 'timbervision'), stdio: 'inherit' });
  console.log('TimberVision worker on http://localhost:5001');
}
const port = process.env.ANALYSIS_PORT || '5000';
const p = spawn(venvPy, ['-m', 'uvicorn', 'main:app', '--port', port, '--log-level', 'warning'], { cwd: dir, stdio: 'inherit' });
console.log(`Analysis service on http://localhost:${port}`);
p.on('exit', (c) => { tv?.kill(); process.exit(c ?? 0); });
process.on('SIGINT', () => { tv?.kill(); p.kill(); });
process.on('SIGTERM', () => { tv?.kill(); p.kill(); });
