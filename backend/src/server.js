import express from 'express';
import cors from 'cors';
import { get, assignCompanies } from './db.js';
import { authRouter, requireAuth, uploadGuard, ensureDemoUsers } from './auth.js';
import { seed } from './seed.js';
import { api } from './api.js';
import { sseHandler } from './events.js';
import { startSim } from './sim.js';
import { analyzeApi, benchmarkAll, syncProfiles, UPLOAD_DIR } from './analyze.js';
import { all } from './db.js';

if (!get('SELECT COUNT(*) c FROM trucks').c) { console.log('Seeding database…'); seed(); assignCompanies(); }
ensureDemoUsers();

const app = express();
app.use(cors());
app.use(express.json());
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.use('/api/auth', authRouter);
app.use('/api', requireAuth); // everything below needs a signed-in user; req.cid is that user's company
app.get('/api/stream', sseHandler);
app.use('/uploads', uploadGuard, express.static(UPLOAD_DIR));
app.use('/api', analyzeApi);
app.use('/api', api);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Pine OS API listening on http://localhost:${PORT}`); startSim();
  // fill in real benchmark numbers for the detector profiles (needs the Python service; retried until it is up)
  const tryBench = () => syncProfiles().then(() => (all('SELECT 1 FROM models WHERE bench_at IS NULL').length ? benchmarkAll().then(() => console.log('Detector benchmark complete')) : null)).catch(() => setTimeout(tryBench, 8000));
  setTimeout(tryBench, 4000);
});
