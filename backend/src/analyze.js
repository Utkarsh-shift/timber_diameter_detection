import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run, tx, kvGet, kvSet, db } from './db.js';
import { refreshTruckStats } from './seed.js';
import { broadcast } from './events.js';
import { nowIso, round } from './util.js';

export const UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PY = process.env.ANALYSIS_URL || 'http://localhost:5000';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });
export const analyzeApi = Router();

class PyError extends Error { constructor(msg, status = 502) { super(msg); this.status = status; } }

async function py(pathname, init) {
  let res;
  try { res = await fetch(PY + pathname, init); } catch {
    throw new PyError('The analysis service is not running. Start it with "npm run dev" (or "npm run dev -w analysis" after "npm run setup:py").', 503);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PyError(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail || body), res.status === 422 ? 422 : 502);
  return body;
}

const handle = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (e) {
    if (!(e instanceof PyError)) console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  }
};

export const rules = (cid) => kvGet('rules:' + cid, {});

analyzeApi.get('/analysis/health', handle(async () => {
  try { return { up: true, ...(await py('/health')) }; } catch (e) { return { up: false, error: e.message }; }
}));

analyzeApi.get('/settings/rules', handle((req) => ({
  grade_a_min_mm: 110, grade_b_min_mm: 90, max_crack_pct: 30, max_ovality: 1.15, reject_rot_pct: 8, wood_density_kg_m3: 900, ...rules(req.cid),
})));
analyzeApi.put('/settings/rules', handle((req) => {
  const keys = ['grade_a_min_mm', 'grade_b_min_mm', 'max_crack_pct', 'max_ovality', 'reject_rot_pct', 'wood_density_kg_m3'];
  const next = {}; for (const k of keys) if (req.body?.[k] != null && !Number.isNaN(+req.body[k])) next[k] = +req.body[k];
  kvSet('rules:' + req.cid, next); broadcast('quality', {}); return { ok: true };
}));

// ---------- photo -> full analysis ----------
const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'samples');
const sampleFile = (name) => {
  const safe = path.basename(String(name || ''));
  const p = path.join(SAMPLES, safe);
  if (!safe || !fs.existsSync(p)) throw new PyError('Unknown sample image.', 404);
  return { buffer: fs.readFileSync(p), mimetype: 'image/jpeg', originalname: safe };
};
analyzeApi.get('/samples', handle(() => (fs.existsSync(SAMPLES) ? fs.readdirSync(SAMPLES).filter((f) => /^(synthetic|truck).*\.jpe?g$/.test(f)) : [])));

// ---------- real annotated dataset (DIIF log-end images + YOLO box ground truth) ----------
const DATASET = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'uploads', 'diif_logend', 'annotated_dataset');
const IMG_EXT = /\.(jpe?g|png)$/i;
let datasetCache = null;
function datasetList() {
  if (datasetCache) return datasetCache;
  const out = [];
  for (const split of ['train', 'val', 'test']) {
    const dir = path.join(DATASET, 'images', split);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => IMG_EXT.test(n))) {
      const lab = path.join(DATASET, 'labels', split, f.replace(IMG_EXT, '.txt'));
      if (!fs.existsSync(lab)) continue;
      out.push({ id: `${split}/${f}`, split, name: f, boxes: fs.readFileSync(lab, 'utf8').split('\n').filter((l) => l.trim()).length });
    }
  }
  return (datasetCache = out.sort((a, b) => b.boxes - a.boxes));
}
function datasetFile(id) {
  const [split, name] = String(id || '').split('/');
  if (!['train', 'val', 'test'].includes(split) || !name || name !== path.basename(name)) throw new PyError('Unknown dataset image.', 404);
  const img = path.join(DATASET, 'images', split, name), lab = path.join(DATASET, 'labels', split, name.replace(IMG_EXT, '.txt'));
  if (!fs.existsSync(img) || !fs.existsSync(lab)) throw new PyError('Unknown dataset image.', 404);
  return { buffer: fs.readFileSync(img), mimetype: /png$/i.test(name) ? 'image/png' : 'image/jpeg', originalname: name, gt: fs.readFileSync(lab, 'utf8') };
}
analyzeApi.get('/dataset', handle(() => ({ available: fs.existsSync(DATASET), name: 'DIIF log-end annotated dataset (Zenodo 10.5281/zenodo.22894169, CC BY 4.0)', items: fs.existsSync(DATASET) ? datasetList() : [] })));
analyzeApi.get('/dataset-image/:split/:name', (req, res) => {
  try { const f = datasetFile(`${req.params.split}/${req.params.name}`); res.type(f.mimetype).send(f.buffer); } catch (e) { res.status(404).json({ error: e.message }); }
});

analyzeApi.get('/sample-image/:name', (req, res) => {
  try { res.type('jpeg').send(sampleFile(req.params.name).buffer); } catch (e) { res.status(404).json({ error: e.message }); }
});

analyzeApi.post('/analyze', upload.single('image'), handle(async (req) => {
  const b = req.body;
  const file = req.file || (b.sample ? sampleFile(b.sample) : b.dataset ? datasetFile(b.dataset) : null);
  if (!file) throw new PyError('Attach a photo in the "image" field.', 400);
  const prod = get("SELECT * FROM models WHERE stage='PRODUCTION'");
  const rig = b.rig_id ? get('SELECT * FROM rigs WHERE id=?', b.rig_id) : null;

  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: file.mimetype || 'image/jpeg' }), file.originalname || 'photo.jpg');
  if (rig) { form.append('scale_mode', 'mm_per_px'); form.append('mm_per_px', String(rig.scale)); }
  else {
    form.append('scale_mode', b.scale_mode || 'ref_width');
    for (const k of ['mm_per_px', 'ref_width_mm', 'ref_mean_mm']) if (b[k]) form.append(k, String(b[k]));
  }
  if (b.log_length_m) form.append('log_length_m', String(b.log_length_m));
  form.append('rules', JSON.stringify(rules(req.cid)));
  if (file.gt) form.append('gt', file.gt);
  form.append('profile', b.profile || prod?.tag || 'ellipse-v1.3-highrecall');
  const r = await py('/analyze', { method: 'POST', body: form });

  const seq = get('SELECT MAX(seq) m FROM trucks').m + 1, id = 'TRK-' + seq;
  const S = r.summary, G = r.grade;
  const tare = +b.tare_kg || 15770;
  const net = +b.gross_kg ? Math.max(0, +b.gross_kg - tare) : S.weight_kg;
  const gross = +b.gross_kg || net + tare;
  const flagged = G.needs_review ? 1 : 0;
  const reason = flagged ? (S.rot_logs ? `Heart rot in ${S.rot_logs} logs` : `Sub-gauge ${S.sub_gauge} logs / grade ${G.grade}`) : null;
  
  fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.jpg`), Buffer.from(r.raw_b64, 'base64'));
  fs.writeFileSync(path.join(UPLOAD_DIR, `${id}-annotated.jpg`), Buffer.from(r.annotated_b64, 'base64'));
  const hhmm = new Date(Date.now() + 3 * 3600000).toISOString().substr(11, 5);

  tx(() => {
    run(`INSERT INTO trucks(id,seq,plate,hauler,supplier_id,po,stage,gate,arrived_at,logs_detected,logs_expected,flagged,flag_reason,inspector,gross_kg,tare_kg,net_kg,ai_kg,moisture,volume,progress,committed,species,driver,image,annotated,img_w,img_h,scale_mm_px,scale_src,source,analysis,infer_ms,engine)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, seq, b.plate || 'UPLOAD-' + seq, b.hauler || 'Walk-in Carrier Oy', null, null, 'verification', 'G-01', nowIso(), S.count, S.count, flagged, reason, 'M. Lindqvist',
      gross, tare, net, S.weight_kg, +b.moisture || 45, S.volume_m3, 78, 0, 'Pinus sylvestris', b.driver || 'Walk-in Driver',
      `/uploads/${id}.jpg`, `/uploads/${id}-annotated.jpg`, r.image.width, r.image.height, r.scale.mm_per_px, r.scale.source, 'upload',
      JSON.stringify({ summary: S, grade: G, scale: r.scale, timing: r.timing, rules: r.rules }), r.timing.inference_ms, r.engine);

    const ins = db.prepare('INSERT INTO logs(truck_id,label,major,minor,eq_dia,area,conf,status,x,y,r,rx,ry,angle,occluded,bark,orig_major,orig_minor,crack,rot,grade,texture_ok) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const l of r.logs) {
      ins.run(id, l.label, l.major_mm, l.minor_mm, l.eq_mm, l.area_cm2, l.conf, ['C', 'R'].includes(l.grade) ? 'FLAGGED' : 'VALID', l.cx_pct, l.cy_pct, l.rx_pct, l.rx_pct, l.ry_pct, l.angle,
        l.occluded ? 1 : 0, l.bark_pct ?? 0, l.major_mm, l.minor_mm, l.crack_pct, l.rot_pct, l.grade, l.texture_ok ? 1 : 0);
    }
    refreshTruckStats(id);

    const defects = [S.sub_gauge ? `${S.sub_gauge} sub-gauge logs (<${r.rules.grade_b_min_mm}mm)` : null, S.rot_logs ? `heart rot in ${S.rot_logs} logs` : null,
      S.avg_crack_pct != null ? `avg crack ${S.avg_crack_pct}%` : 'crack/rot not measurable at this resolution', `avg ovality ${S.avg_ovality}`, `bark ${S.avg_bark_pct}%`].filter(Boolean).join(', ');
    run('INSERT INTO consignments(truck_id,gate,intake_time,species,geo,grade,purity,defects,action,action_tone,verification,needs_review) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      id, 'UPLOAD', hhmm + ' EEST', 'Pinus sylvestris', '#UPLOAD-' + (1000 + seq), G.grade, G.purity, defects, G.action, G.tone,
      G.needs_review ? 'PENDING HUMAN SIGN-OFF' : 'AI Automated (No Review Req)', G.needs_review ? 1 : 0);
    run('UPDATE trucks SET company_id=? WHERE id=?', req.cid, id);
    run('UPDATE consignments SET company_id=? WHERE truck_id=?', req.cid, id);

    const low = r.logs.filter((l) => l.conf < 80 || l.occluded);
    if (low.length) run("INSERT INTO hitl(cls,cam,conf,anomaly,image,status) VALUES(?,?,?,?,?,'pending')", low.some((l) => l.occluded) ? 'BOUNDARY_OCCLUSION' : 'LOW_CONFIDENCE', `Upload • ${id}`, Math.min(...low.map((l) => l.conf)), `${low.length} logs occluded or <80% confidence`, `/uploads/${id}-annotated.jpg`);
    run('INSERT INTO metrics_ts(ts,latency,fps,queue) VALUES(?,?,?,?)', Date.now(), round(r.timing.inference_ms / Math.max(1, S.count) , 1), round(1000 / Math.max(1, r.timing.inference_ms), 1), get("SELECT COUNT(*) c FROM trucks WHERE stage!='completed'").c);
  });
  if (r.eval) run('UPDATE trucks SET gt=? WHERE id=?', JSON.stringify({ boxes: r.gt_boxes, eval: r.eval, source: b.dataset }), id);
  broadcast('truck', { id }); broadcast('quality', {});
  return { id, eval: r.eval, summary: S, grade: G, scale: r.scale, timing: r.timing };
}));

// ---------- real camera calibration from checkerboard photos ----------
analyzeApi.post('/calibration/upload', upload.array('images', 30), handle(async (req) => {
  if (!req.files?.length) throw new PyError('Attach 3+ checkerboard photos in "images".', 400);
  const form = new FormData();
  for (const f of req.files) form.append('files', new Blob([f.buffer], { type: f.mimetype }), f.originalname);
  for (const k of ['cols', 'rows', 'square_mm']) if (req.body[k]) form.append(k, String(req.body[k]));
  return py('/calibrate', { method: 'POST', body: form });
}));
analyzeApi.post('/calibration/sample', handle(async (req) => {
  const names = fs.existsSync(SAMPLES) ? fs.readdirSync(SAMPLES).filter((f) => /^checkerboard_.*\.jpe?g$/.test(f)) : [];
  if (names.length < 3) throw new PyError('No bundled checkerboard samples found in /samples.', 404);
  const form = new FormData();
  for (const n of names) form.append('files', new Blob([fs.readFileSync(path.join(SAMPLES, n))], { type: 'image/jpeg' }), n);
  form.append('cols', '9'); form.append('rows', '6'); form.append('square_mm', '40');
  return { ...(await py('/calibrate', { method: 'POST', body: form })), cols: 9, rows: 6 };
}));
analyzeApi.post('/rigs/:id/apply-calibration', handle((req) => {
  const c = req.body; const rig = get('SELECT * FROM rigs WHERE id=?', req.params.id);
  if (!rig || !c?.rms) throw new PyError('Missing rig or calibration result', 400);
  const n = get('SELECT COUNT(*) c FROM calib_events').c;
  tx(() => {
    run("UPDATE rigs SET status='ONLINE', valid_days=30, reproj=?, scale=?, drift=0.01, intrinsics=?, profile=? WHERE id=?", round(c.rms, 3), round(c.mm_per_px, 4), JSON.stringify(c), 'v' + (+rig.profile.slice(1) + 0.1).toFixed(1), rig.id);
    run('INSERT INTO calib_events VALUES(?,?,?,?,?,?,?,?,?,?)', 'EV-' + (90300 + n), new Date().toISOString().slice(0, 16).replace('T', ' '), rig.id, rig.hardware.split(' •')[0], `Checkerboard ${c.cols || 9}x${c.rows || 6}`, round(c.rms, 3), round(c.mm_per_px, 4), 'M. Lindqvist (#802)', 'CERT-SHA256', 'VERIFIED');
  });
  broadcast('rig', {}); return { ok: true };
}));

// ---------- model profiles ----------
const PROFILE_DESC = {
  'ellipse-v1.3-highrecall': 'OpenCV Hough + DT seeds, relaxed thresholds',
  'ellipse-v1.4-wild': 'OpenCV, wide size band for mixed-size piles',
  'timbervision-v1.0-seg': 'TimberVision YOLOv8-L segmentation (log end faces) — non-commercial licence',
};
export async function syncProfiles() {
  const h = await py('/health');
  // profiles that were removed from the analysis service disappear from the Models page too; one profile stays in production
  for (const m of all('SELECT tag FROM models')) if (!h.profiles.includes(m.tag)) run('DELETE FROM models WHERE tag=?', m.tag);
  if (!get("SELECT 1 x FROM models WHERE stage='PRODUCTION'")) run("UPDATE models SET stage='PRODUCTION' WHERE tag=?", h.profiles.includes('ellipse-v1.3-highrecall') ? 'ellipse-v1.3-highrecall' : h.profiles[0]);
  for (const tag of h.profiles) {
    if (get('SELECT 1 x FROM models WHERE tag=?', tag)) continue;
    const learned = tag === (process.env.CANDIDATE_PROFILE || 'timbervision-v1.0-seg');
    if (learned) run("UPDATE models SET stage='ARCHIVED' WHERE stage='CANDIDATE'");
    run('INSERT INTO models(tag,weights,stage,notes) VALUES(?,?,?,?)', tag, PROFILE_DESC[tag] || tag, learned ? 'CANDIDATE' : 'ARCHIVED',
      learned ? 'Much better on real in-the-wild photos (see real-data F1) but weaker on uniform synthetic stacks and very small photos — compare both columns before promoting.' : '');
  }
}
let realCache = { t: 0, v: {} };
export async function realEval() {
  if (Date.now() - realCache.t < 30000) return realCache.v;
  try { realCache = { t: Date.now(), v: await py('/real-eval') }; } catch { realCache = { t: Date.now(), v: {} }; }
  return realCache.v;
}

// ---------- model profiles: real benchmark on the synthetic validation pile ----------
export async function benchmarkAll() {
  for (const m of all('SELECT * FROM models ORDER BY id')) {
    let b;
    try { b = await py('/benchmark?profile=' + encodeURIComponent(m.tag)); } catch (e) { console.warn('benchmark skipped for', m.tag, '-', e.message); continue; }
    run('UPDATE models SET det_map=?, seg_map=?, latency=?, mae=?, precision_pct=?, recall_pct=?, bench_at=? WHERE id=?', b.f1, b.mean_iou, b.latency_ms, b.mae_mm, b.precision, b.recall, nowIso(), m.id);
  }
}
analyzeApi.post('/models/benchmark', handle(async () => { await benchmarkAll(); broadcast('model', {}); return { ok: true }; }));

analyzeApi.post('/trucks/:id/logs', handle((req) => {
  const t = get('SELECT * FROM trucks WHERE id=?', req.params.id); if (!t) throw new PyError('not found', 404);
  const { x, y } = req.body || {};
  const ls = all("SELECT eq_dia, rx, ry, r, angle FROM logs WHERE truck_id=? AND status!='REJECTED'", t.id);
  const rx = ls.map((l) => l.rx ?? l.r).sort((a, b) => a - b)[Math.floor(ls.length / 2)] || 2.5;
  const ratio = ls.map((l) => l.eq_dia / (2 * (l.rx ?? l.r))).sort((a, b) => a - b)[Math.floor(ls.length / 2)] || 40; // mm per width-percent
  const d = round(2 * rx * ratio, 1); const n = get('SELECT COUNT(*) c FROM logs WHERE truck_id=?', t.id).c + 1;
  const r = run('INSERT INTO logs(truck_id,label,major,minor,eq_dia,area,conf,status,x,y,r,rx,ry,angle,occluded,bark,orig_major,orig_minor,edited,grade,texture_ok) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    t.id, 'LOG-' + String(n).padStart(3, '0'), d, d, d, round(Math.PI * (d / 20) ** 2, 1), 100, d < 90 ? 'FLAGGED' : 'VALID', +x, +y, rx, rx, rx, 0, 0, 0, d, d, 1, d < 90 ? 'C' : 'A', 0);
  run('INSERT INTO log_edits(log_id,truck_id,action,reason,operator,ts) VALUES(?,?,?,?,?,?)', Number(r.lastInsertRowid), t.id, 'add_missed', 'Added manually in Studio', 'ML-819', nowIso());
  refreshTruckStats(t.id); return { id: Number(r.lastInsertRowid) };
}));
