import { Router } from 'express';
import { all, get, run, tx, kvGet, kvSet } from './db.js';
import { mean, median, std, pct, round, nowIso, rng } from './util.js';
import { refreshTruckStats, STAGES, progressFor } from './seed.js';
import { broadcast } from './events.js';
import os from 'node:os';
import { rules as getRules, realEval } from './analyze.js';

export const api = Router();
const wrap = (fn) => async (req, res) => {
  try { const out = await fn(req, res); if (out !== undefined && !res.headersSent) res.json(out); } catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: e.message }); }
};

const BANDS = [['<80', 0, 80], ['80-100', 80, 100], ['100-120', 100, 120], ['120-140', 120, 140], ['140-160', 140, 160], ['>160', 160, 999]];
const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? round(mean(v), 2) : null; };
const histogram = (vals, lo = 80, hi = 170, step = 10) => {
  const out = [];
  for (let a = lo; a < hi; a += step) out.push({ from: a, to: a + step, count: vals.filter((v) => v >= a && v < a + step).length });
  return out;
};
const trucksQ = (where = '', ...p) => all(`SELECT t.* FROM trucks t ${where}`, ...p);
const hhmm = (iso) => { const d = new Date(new Date(iso).getTime() + 3 * 3600000); return d.toISOString().substr(11, 5); };

// ---------- overview ----------
function processStats(trucks, live) {
  const up = trucks.filter((t) => t.source === 'upload' && t.infer_ms);
  const lat = get('SELECT latency FROM metrics_ts ORDER BY id DESC LIMIT 1');
  const avgVol = mean(trucks.map((t) => t.volume)) || 0;
  return {
    avg_process: up.length ? round(mean(up.map((t) => t.infer_ms)) / 1000, 1) + ' s' : '–', process_sub: up.length ? `${up.length} photo${up.length > 1 ? 's' : ''} analysed this shift` : 'Upload a photo to measure',
    edge_ms: lat ? lat.latency : null, yard_cap: round((live.length / 12) * 100, 1), delta_m3: round(trucks.reduce((s, t) => s + t.volume, 0) - 65 * avgVol * (trucks.length / 65), 0),
    uploads: up.length,
  };
}
api.get('/overview', wrap((req) => {
  // optional from/to: ISO instants (from inclusive, to exclusive) sent by the date picker
  const { from, to } = req.query;
  const lo = from || '0000', hi = to || '9999';
  const trucks = trucksQ('WHERE t.company_id = ? AND t.arrived_at >= ? AND t.arrived_at < ? ORDER BY t.seq DESC', req.cid, lo, hi);
  const done = trucks.filter((t) => t.stage === 'completed');
  const live = trucks.filter((t) => t.stage !== 'completed');
  const lg = all("SELECT l.eq_dia FROM logs l JOIN trucks t ON t.id=l.truck_id WHERE l.status!='REJECTED' AND t.company_id = ? AND t.arrived_at >= ? AND t.arrived_at < ?", req.cid, lo, hi).map((x) => x.eq_dia);
  const volume = round(trucks.reduce((s, t) => s + t.volume, 0), 0);
  const hourly = [];
  for (let h = 6; h <= 14; h++) {
    const vol = trucks.filter((t) => new Date(t.arrived_at).getUTCHours() + 3 === h).reduce((s, t) => s + t.volume, 0);
    hourly.push({ hour: String(h).padStart(2, '0') + ':00', volume: round(vol, 0) });
  }
  const bands = BANDS.map(([label, a, b]) => ({ label, count: lg.filter((v) => v >= a && v < b).length }));
  const stageCounts = {}; trucks.forEach((t) => { const k = t.flagged && t.stage !== 'completed' ? 'flagged' : t.stage; stageCounts[k] = (stageCounts[k] || 0) + 1; });
  stageCounts.flagged = (stageCounts.flagged || 0) + done.filter((t) => t.flagged).length;
  return {
    kpis: {
      trucks: trucks.length, target: 65, blocks: lg.length, avg_dia: round(mean(lg)), median_dia: round(median(lg)), std_dia: round(std(lg)), p90: round(pct(lg, 0.9)),
      volume, tons: round(volume * 0.76, 0), queue: live.length, flagged: trucks.filter((t) => t.flagged).length, ...processStats(trucks, live),
    },
    hourly, bands, hist: histogram(lg, 70, 170, 10),
    spark: trucks.slice(0, 30).reverse().map((t) => t.logs_detected),
    ms_series: trucks.filter((t) => t.source === 'upload' && t.infer_ms).slice(0, 12).reverse().map((t) => Math.round(t.infer_ms)),
    stages: stageCounts, total_trucks: trucks.length,
    recent: trucks.slice(0, 6).map((t) => ({ ...t, time: hhmm(t.arrived_at) })),
    throughput: round(trucks.length / 3.75, 1),
  };
}));

// ---------- trucks ----------
api.get('/trucks', wrap((req) => {
  const { stage, q } = req.query; const page = +(req.query.page || 1), size = +(req.query.size || 5);
  let rows = trucksQ("WHERE t.company_id=? AND (t.stage!='completed' OR t.seq>=9843) ORDER BY CASE t.stage WHEN 'completed' THEN 1 ELSE 0 END, t.seq DESC", req.cid);
  if (stage) rows = rows.filter((t) => t.stage === stage);
  if (q) rows = rows.filter((t) => (t.id + t.plate).toLowerCase().includes(String(q).toLowerCase()));
  const counts = Object.fromEntries(STAGES.map((s) => [s, get('SELECT COUNT(*) c FROM trucks WHERE stage=? AND company_id=?', s, req.cid).c]));
  const total = rows.length;
  return {
    counts, in_yard: all("SELECT COUNT(*) c FROM trucks WHERE stage!='completed' AND company_id=?", req.cid)[0].c, total, page, pages: Math.max(1, Math.ceil(total / size)),
    items: rows.slice((page - 1) * size, page * size).map((t) => ({ ...t, time: hhmm(t.arrived_at), wait: Math.max(1, Math.round((Date.now() - new Date(t.arrived_at).getTime()) / 60000) % 25) })),
  };
}));
api.get('/trucks/:id', wrap((req, res) => {
  const t = trucksQ('WHERE t.id=?', req.params.id)[0];
  if (!t) return res.status(404).json({ error: 'not found' });
  return { ...t, time: hhmm(t.arrived_at) };
}));
api.post('/trucks/:id/advance', wrap((req) => advanceTruck(req.params.id)));
api.post('/trucks/:id/flag', wrap((req) => { run('UPDATE trucks SET flagged=1, flag_reason=? WHERE id=?', req.body?.reason || 'Manual flag', req.params.id); broadcast('truck', { id: req.params.id }); return { ok: true }; }));
api.post('/trucks/:id/commit', wrap((req) => {
  const id = req.params.id; const t = get('SELECT * FROM trucks WHERE id=?', id);
  refreshTruckStats(id);
  tx(() => {
    run("UPDATE trucks SET stage='completed', progress=100, committed=1 WHERE id=?", id);
    if (!get('SELECT 1 x FROM certificates WHERE truck_id=?', id)) {
      const r = rng(t.seq); const sha = [...Array(8)].map(() => Math.floor(r() * 65536).toString(16).padStart(4, '0')).join('');
      run('INSERT INTO certificates VALUES(?,?,?,?,?,?)', id, `#PINE-CERT-2024-10-${t.seq}`, nowIso(), sha, `#${8839104 + t.seq % 1000}`, `#SAP-GR-${9012488 + t.seq % 1000}`);
    }
  });
  broadcast('truck', { id });
  return { ok: true, id };
}));
export function advanceTruck(id) {
  const t = get('SELECT * FROM trucks WHERE id=?', id); if (!t) return { error: 'not found' };
  const i = STAGES.indexOf(t.stage); if (i < 0 || i >= STAGES.length - 1) return t;
  const next = STAGES[i + 1];
  if (next === 'completed') {
    run("UPDATE trucks SET stage='completed', progress=100, committed=1 WHERE id=?", id);
    if (!get('SELECT 1 x FROM certificates WHERE truck_id=?', id)) run('INSERT INTO certificates VALUES(?,?,?,?,?,?)', id, `#PINE-CERT-2024-10-${t.seq}`, nowIso(), 'a1b2c3d4e5f60718', `#${8839104 + t.seq % 1000}`, `#SAP-GR-${9012488 + t.seq % 1000}`);
  } else run('UPDATE trucks SET stage=?, progress=? WHERE id=?', next, progressFor(next), id);
  broadcast('truck', { id });
  return get('SELECT * FROM trucks WHERE id=?', id);
}

// ---------- logs / measurement studio ----------
api.get('/trucks/:id/logs', wrap((req) => {
  const logs = all('SELECT * FROM logs WHERE truck_id=? ORDER BY id', req.params.id);
  const valid = logs.filter((l) => l.status !== 'REJECTED'); const eq = valid.map((l) => l.eq_dia);
  const minor = valid.map((l) => l.minor);
  return {
    logs,
    aggregates: {
      total: logs.length, valid: valid.filter((l) => l.status === 'VALID').length, flagged: valid.filter((l) => l.status === 'FLAGGED').length, occluded: logs.filter((l) => l.occluded).length,
      edits: get('SELECT COUNT(*) c FROM log_edits WHERE truck_id=?', req.params.id).c,
      mean: round(mean(eq)), median: round(median(eq)), std: round(std(eq)), min: Math.min(...eq), max: Math.max(...eq), solid: round(valid.reduce((s, l) => s + l.area, 0) / 10000, 2),
      under: valid.filter((l) => l.eq_dia < 90).length, ovality: valid.filter((l) => l.major / l.minor > 1.2).length,
      hist: histogram(eq, 80, 160, 10),
      avg_crack: avg(valid.filter((l) => l.texture_ok).map((l) => l.crack)), avg_rot: avg(valid.filter((l) => l.texture_ok).map((l) => l.rot)), avg_bark: avg(valid.map((l) => l.bark)),
      grades: ['A', 'B', 'C', 'R'].map((g) => ({ g, n: valid.filter((l) => l.grade === g).length })), measured_texture: valid.filter((l) => l.texture_ok).length,
      within_ovality: round(100 * valid.filter((l) => l.major / l.minor <= 1.2).length / Math.max(1, valid.length), 1),
    },
  };
}));
api.get('/trucks/:id/audit', wrap((req) => all('SELECT e.*, l.label FROM log_edits e JOIN logs l ON l.id=e.log_id WHERE e.truck_id=? ORDER BY e.id DESC LIMIT 50', req.params.id)));
api.patch('/logs/:id', wrap((req, res) => {
  const l = get('SELECT * FROM logs WHERE id=?', req.params.id); if (!l) return res.status(404).json({ error: 'not found' });
  const { action, delta = 1, reason = '' } = req.body || {};
  let { major, minor, eq_dia, status, bark } = l;
  if (action === 'nudge') { major = round(major + delta); eq_dia = round(Math.sqrt(major * minor)); }
  else if (action === 'diameter') { const k = (eq_dia + delta) / eq_dia; major = round(major * k); minor = round(minor * k); eq_dia = round(eq_dia + delta); }
  else if (action === 'exclude_bark') { const k = 1 - bark / 100; major = round(major * k); minor = round(minor * k); eq_dia = round(eq_dia * k); bark = 0; }
  else if (action === 'false_positive') status = 'REJECTED';
  else if (action === 'reset') { major = l.orig_major; minor = l.orig_minor; eq_dia = round(Math.sqrt(major * minor)); status = 'VALID'; }
  else return res.status(400).json({ error: 'bad action' });
  if (status !== 'REJECTED') status = eq_dia < 90 ? 'FLAGGED' : 'VALID';
  run('UPDATE logs SET major=?, minor=?, eq_dia=?, area=?, bark=?, status=?, edited=? WHERE id=?', major, minor, eq_dia, round(Math.PI * (eq_dia / 20) ** 2, 1), bark, status, action === 'reset' ? 0 : 1, l.id);
  run('INSERT INTO log_edits(log_id,truck_id,action,reason,operator,ts) VALUES(?,?,?,?,?,?)', l.id, l.truck_id, action, reason, 'ML-819', nowIso());
  if (l.rx != null && l.eq_dia) { const k = eq_dia / l.eq_dia; run('UPDATE logs SET rx=?, ry=? WHERE id=?', l.rx * k, l.ry * k, l.id); }
  refreshTruckStats(l.truck_id);
  return get('SELECT * FROM logs WHERE id=?', l.id);
}));

// ---------- reports ----------
function report(id) {
  const t = trucksQ('WHERE t.id=?', id)[0]; if (!t) return null;
  const logs = all("SELECT * FROM logs WHERE truck_id=? AND status!='REJECTED'", id); const eq = logs.map((l) => l.eq_dia);
  const cert = get('SELECT * FROM certificates WHERE truck_id=?', id);
  const inSpec = eq.filter((d) => d >= 100 && d <= 150).length;
  const area = round(logs.reduce((s, l) => s + l.area, 0) / 10000, 2);
  return {
    truck: t, cert, stats: { count: eq.length, mean: round(mean(eq)), median: round(median(eq)), std: round(std(eq)), q1: round(pct(eq, 0.25)), q3: round(pct(eq, 0.75)), min: Math.min(...eq), max: Math.max(...eq), area, solid: round(area * 5, 2), in_tolerance: round(100 * inSpec / Math.max(1, eq.length), 1) },
    hist: histogram(eq, 80, 170, 10),
    quality: { circularity: round(100 * mean(logs.map((l) => l.minor / l.major)), 1), cracks: avg(logs.filter((l) => l.texture_ok).map((l) => l.crack)) ?? 0.2, bark: round(100 - (avg(logs.map((l) => l.bark)) ?? 1.6), 1), noncompliant: logs.filter((l) => ['C', 'R'].includes(l.grade) || l.eq_dia < 90).length, measured: logs.filter((l) => l.texture_ok).length },
    analysis: t.analysis ? JSON.parse(t.analysis) : null,
  };
}
api.get('/reports', wrap((req) => all("SELECT t.id, t.seq FROM trucks t JOIN certificates c ON c.truck_id=t.id WHERE t.company_id=? ORDER BY t.seq DESC LIMIT 12", req.cid)));
// all issued reports of the company, newest first (optional q, from/to, page/size)
api.get('/report-list', wrap((req) => {
  const { q, from, to } = req.query, size = Math.min(100, +req.query.size || 12), page = Math.max(1, +req.query.page || 1);
  const like = '%' + String(q || '').toLowerCase() + '%';
  const where = 'FROM trucks t JOIN certificates c ON c.truck_id=t.id WHERE t.company_id=? AND t.arrived_at >= ? AND t.arrived_at < ? AND (lower(t.id) LIKE ? OR lower(t.plate) LIKE ?)';
  const args = [req.cid, from || '0000', to || '9999', like, like];
  const total = get('SELECT COUNT(*) n ' + where, ...args).n;
  const items = all('SELECT t.id, t.plate, t.arrived_at, t.logs_detected, t.avg_dia, t.std_dia, t.flagged, c.issued_at ' + where + ' ORDER BY t.seq DESC LIMIT ? OFFSET ?', ...args, size, (page - 1) * size).map((t) => ({ ...t, time: hhmm(t.arrived_at) }));
  return { items, total, page, pages: Math.max(1, Math.ceil(total / size)) };
}));
api.get('/reports/:id', wrap((req, res) => report(req.params.id) || res.status(404).json({ error: 'not found' })));
// per-log export of one truck (CSV or Excel); both share the same columns
const EXPORT_COLS = [['Log', 'label'], ['Major axis (mm)', 'major'], ['Minor axis (mm)', 'minor'], ['Diameter (mm)', 'eq_dia'], ['Ovality', 'ovality'], ['Area (cm2)', 'area'], ['Confidence (%)', 'conf'], ['Status', 'status'], ['Grade', 'grade'], ['Bark (%)', 'bark'], ['Crack (%)', 'crack'], ['Rot (%)', 'rot']];
const exportRows = (id) => all('SELECT * FROM logs WHERE truck_id=? ORDER BY id', id).map((l) => ({ ...l, ovality: l.minor ? round(l.major / l.minor, 3) : null, crack: l.texture_ok ? l.crack : null, rot: l.texture_ok ? l.rot : null }));
const csvCell = (v) => { const x = v == null ? '' : String(v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
api.get('/reports/:id/csv', (req, res) => {
  const rows = exportRows(req.params.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}-logs.csv"`);
  res.send('\uFEFF' + [EXPORT_COLS.map((c) => csvCell(c[0])).join(','), ...rows.map((r) => EXPORT_COLS.map((c) => csvCell(r[c[1]])).join(','))].join('\n'));
});
api.get('/reports/:id/xlsx', wrap(async (req, res) => {
  const t = get('SELECT * FROM trucks WHERE id=?', req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 22 }, { width: 28 }];
  [['Truck', t.id], ['Plate', t.plate], ['Arrived', t.arrived_at], ['Logs', t.logs_detected], ['Mean diameter (mm)', t.avg_dia], ['Median diameter (mm)', t.median_dia], ['Std dev (mm)', t.std_dia], ['Flagged', t.flagged ? t.flag_reason || 'yes' : 'no']].forEach((r) => sum.addRow(r));
  sum.getColumn(1).font = { bold: true };
  const ws = wb.addWorksheet('Logs');
  ws.columns = EXPORT_COLS.map(([header, key]) => ({ header, key, width: Math.max(10, header.length + 2) }));
  ws.addRows(exportRows(req.params.id));
  ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}-logs.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

// ---------- quality ----------
api.get('/quality', wrap((req) => {
  // optional ?from=&to= (ISO instants) limits everything to that period, ?truck= picks the analysed photo the KPIs describe
  const { from, to, truck } = req.query;
  const ranged = !!(from || to), lo = from || '0000', hi = to || '9999';
  const cons = all('SELECT c.*, t.arrived_at FROM consignments c LEFT JOIN trucks t ON t.id=c.truck_id WHERE c.company_id=? AND (? = 0 OR (t.arrived_at >= ? AND t.arrived_at < ?)) ORDER BY c.id', req.cid, ranged ? 1 : 0, lo, hi);
  const uploads = all("SELECT id, plate, arrived_at FROM trucks WHERE source='upload' AND company_id=? AND arrived_at >= ? AND arrived_at < ? ORDER BY seq DESC LIMIT 200", req.cid, lo, hi);
  const R = { grade_a_min_mm: 110, grade_b_min_mm: 90, max_crack_pct: 30, max_ovality: 1.15, reject_rot_pct: 8, ...getRules(req.cid) };
  const pick = uploads.find((u) => u.id === truck) || uploads[0];
  const last = pick ? get('SELECT * FROM trucks WHERE id=?', pick.id) : null;
  let k = { yield: 94.2, delam: 1.6, rot: 0.4, ovality: 1.08, crack: null, measured: 0, source: null }, curve = [0, 1, 2, 4, 8, 15, 28, 46, 62, 44, 24, 12, 8, 5, 3, 2, 1.4, 2, 3, 2, 1], hero = null;
  if (last) {
    const lg = all("SELECT * FROM logs WHERE truck_id=? AND status!='REJECTED'", last.id), tex = lg.filter((l) => l.texture_ok);
    const an = JSON.parse(last.analysis || '{}');
    k = {
      yield: round(an.grade?.purity ?? 0, 1), delam: round(mean(lg.map((l) => l.bark)), 1), rot: tex.length ? round(mean(tex.map((l) => l.rot || 0)), 2) : null,
      ovality: round(mean(lg.map((l) => l.major / l.minor)), 3), sym_pass: round((100 * lg.filter((l) => l.major / l.minor <= (R.max_ovality || 1.15)).length) / Math.max(1, lg.length), 1), crack: tex.length ? round(mean(tex.map((l) => l.crack || 0)), 1) : null, measured: tex.length, source: last.id,
    };
    const ov = lg.map((l) => l.major / l.minor);
    curve = Array.from({ length: 21 }, (_, i) => ov.filter((v) => v >= 1 + i * 0.015 && v < 1 + (i + 1) * 0.015).length);
    const worst = [...lg].sort((x, y) => (y.rot || 0) + (y.crack || 0) / 4 - ((x.rot || 0) + (x.crack || 0) / 4) || x.eq_dia - y.eq_dia)[0];
    hero = { truck: last, log: worst };
  }
  return {
    kpis: { ...k, reinspect: cons.filter((c) => c.needs_review && !c.signed_off).length },
    rules: [['GRADE A (PREMIUM)', `>${R.grade_a_min_mm}mm • <${R.max_crack_pct}% crack length • ovality ≤${R.max_ovality}`], ['GRADE B (STANDARD)', `${R.grade_b_min_mm}-${R.grade_a_min_mm}mm or minor defects`], ['GRADE C (SUB-GAUGE)', `<${R.grade_b_min_mm}mm • Chipper only`], ['REJECT BAND', `Heart rot ≥${R.reject_rot_pct}% of end-face`]],
    curve, consignments: cons, hero, trucks: uploads, selected: pick?.id || null,
  };
}));
api.post('/consignments/:id/disposition', wrap((req) => {
  const { disposition, sign_off } = req.body || {}; const c = get('SELECT * FROM consignments WHERE id=?', req.params.id);
  run('UPDATE consignments SET disposition=?, signed_off=?, verification=?, needs_review=? WHERE id=?', disposition || c.disposition, sign_off ? 1 : c.signed_off, sign_off ? `SIGNED OFF • ${disposition || 'Confirmed'}` : c.verification, sign_off ? 0 : c.needs_review, c.id);
  broadcast('quality', {}); return get('SELECT * FROM consignments WHERE id=?', c.id);
}));


// ---------- calibration ----------
api.get('/calibration', wrap(() => {
  const rigs = all('SELECT * FROM rigs ORDER BY id').map((r) => ({ ...r, extra: JSON.parse(r.extra) }));
  return { rigs, events: all('SELECT * FROM calib_events ORDER BY ts DESC'), kpis: { online: rigs.filter((r) => r.status === 'ONLINE').length, total: rigs.length, due: rigs.filter((r) => r.status !== 'ONLINE').length } };
}));
api.post('/rigs/:id/calibrate', wrap((req) => {
  const r = get('SELECT * FROM rigs WHERE id=?', req.params.id); const rr = rng(Date.now() % 100000);
  const reproj = round(0.1 + rr() * 0.05, 3), n = get('SELECT COUNT(*) c FROM calib_events').c;
  tx(() => {
    run("UPDATE rigs SET status='ONLINE', valid_days=30, reproj=?, drift=0.01, profile=? WHERE id=?", reproj, 'v' + (+r.profile.slice(1) + 0.1).toFixed(1), r.id);
    run('INSERT INTO calib_events VALUES(?,?,?,?,?,?,?,?,?,?)', 'EV-' + (90300 + n), new Date().toISOString().slice(0, 16).replace('T', ' '), r.id, r.hardware.split(' •')[0], 'ChArUco 12x9 40mm', reproj, r.scale, 'M. Lindqvist (#802)', 'CERT-SHA256', 'VERIFIED');
  });
  broadcast('rig', {}); return { ok: true, reproj };
}));
api.post('/calibration/solve', wrap((req) => {
  const rr = rng(Date.now() % 9999);
  return { K: { fx: round(3284.18 + rr() * 0.3, 2), fy: round(3285.91 + rr() * 0.3, 2), cx: 2048.12, cy: 1081.44 }, dist: { k1: -0.041829, k2: 0.002148, p1: -0.000104, p2: 0.000088 }, rms: round(0.11 + rr() * 0.03, 3), poses: 48 };
}));

// ---------- models ----------
api.get('/models', wrap(async () => {
  const real = await realEval();
  const series = all('SELECT * FROM metrics_ts ORDER BY ts DESC LIMIT 48').reverse();
  const models = all('SELECT * FROM models ORDER BY id'); const prod = models.find((m) => m.stage === 'PRODUCTION');
  const up = all("SELECT infer_ms, analysis FROM trucks WHERE source='upload'");
  const sigma = prod?.mae ? prod.mae * 1.25 : 1;
  const mem = process.memoryUsage();
  return {
    kpis: { arch: prod?.tag, f1: prod?.det_map, iou: prod?.seg_map, mae: prod?.mae, latency: prod?.latency, precision: prod?.precision_pct, recall: prod?.recall_pct, bench_at: prod?.bench_at,
      photos: up.length, live_ms: up.length ? round(mean(up.map((t) => t.infer_ms)), 0) : null },
    models: models.map((m) => ({ ...m, real: real[m.tag] || null })), hitl: all("SELECT * FROM hitl WHERE status='pending' ORDER BY id DESC LIMIT 6"), series,
    nodes: [
      { id: 'Node API server', status: 'ACTIVE', descr: `Express + SQLite • Node ${process.version}`, temp: null, vram: round(mem.rss / 1e9, 2), cap: round(os.totalmem() / 1e9, 0), unit: 'GB RSS' },
      { id: 'Node analysis service', status: 'ACTIVE', descr: `Python OpenCV • ${os.cpus().length} logical CPUs`, temp: null, vram: round((os.totalmem() - os.freemem()) / 1e9, 1), cap: round(os.totalmem() / 1e9, 0), unit: 'GB system RAM in use' },
    ],
    datasets: [['Real DIIF log-end photos', 146, 'Real photos + box ground truth (CC BY 4.0), used for held-out evaluation'], ['Synthetic validation pile', 461, 'Known-diameter discs, bark rim, rings, cracks, rot'], ['Uploaded photos', up.length, 'Analysed in this demo (not yet labelled)'], ['HITL queue', get("SELECT COUNT(*) c FROM hitl WHERE status='pending'").c, 'Low-confidence / occluded frames']],
    err: Array.from({ length: 17 }, (_, i) => { const x = (i - 8) / 2; return { x, n: Math.round(100 * Math.exp(-(x * x) / (2 * sigma * sigma))) }; }),
  };
}));
api.post('/models/:id/promote', wrap((req) => {
  tx(() => { run("UPDATE models SET stage='ARCHIVED' WHERE stage='PRODUCTION'"); run("UPDATE models SET stage='PRODUCTION', notes='' WHERE id=?", req.params.id); });
  broadcast('model', {}); return { ok: true };
}));
api.post('/models/:id/rollback', wrap((req) => {
  const cur = get("SELECT * FROM models WHERE stage='PRODUCTION'"); const prev = get("SELECT * FROM models WHERE stage='ARCHIVED' ORDER BY id DESC LIMIT 1");
  if (cur && prev) tx(() => { run("UPDATE models SET stage='CANDIDATE' WHERE id=?", cur.id); run("UPDATE models SET stage='PRODUCTION' WHERE id=?", prev.id); });
  broadcast('model', {}); return { ok: true };
}));
api.post('/hitl/:id/annotate', wrap((req) => { run("UPDATE hitl SET status='annotated' WHERE id=?", req.params.id); return { ok: true }; }));

// ---------- history ----------
// all trucks of the company (queue + completed): ?stage= (ai_inference|verification|completed) or ?status=flagged, ?q=, ?from=&to=, ?page=&size=
function historyRows(req) {
  const { stage, status, q, from, to } = req.query;
  const like = '%' + String(q || '').toLowerCase() + '%';
  const base = 'FROM trucks t WHERE t.company_id=? AND t.arrived_at >= ? AND t.arrived_at < ? AND (lower(t.id) LIKE ? OR lower(t.plate) LIKE ?)';
  const args = [req.cid, from || '0000', to || '9999', like, like];
  let where = base, extra = [];
  if (stage) { where += ' AND t.stage=?'; extra = [stage]; }
  else if (status === 'flagged') where += ' AND t.flagged=1';
  return { base, args, where, extra };
}
api.get('/history', wrap((req) => {
  const size = Math.min(100, +req.query.size || 15), page = Math.max(1, +req.query.page || 1);
  const { base, args, where, extra } = historyRows(req);
  const counts = Object.fromEntries(all('SELECT t.stage s, COUNT(*) n ' + base + ' GROUP BY t.stage', ...args).map((r) => [r.s, r.n]));
  const total = get('SELECT COUNT(*) n ' + where, ...args, ...extra).n;
  counts.flagged = get('SELECT COUNT(*) n ' + base + ' AND t.flagged=1', ...args).n;
  counts.all = Object.values(counts).reduce((a, b) => a + b, 0) - counts.flagged;
  const items = all('SELECT t.* ' + where + ' ORDER BY t.seq DESC LIMIT ? OFFSET ?', ...args, ...extra, size, (page - 1) * size).map((t) => ({ ...t, time: hhmm(t.arrived_at) }));
  return { items, total, page, pages: Math.max(1, Math.ceil(total / size)), counts, in_yard: (counts.ai_inference || 0) + (counts.verification || 0) };
}));
api.get('/history/csv', (req, res) => {
  const { where, args, extra } = historyRows(req);
  const rows = all('SELECT t.id, t.plate, t.arrived_at, t.stage, t.flagged, t.logs_detected, t.avg_dia, t.median_dia, t.std_dia ' + where + ' ORDER BY t.seq DESC LIMIT 5000', ...args, ...extra);
  const cell = (v) => { const x = v == null ? '' : String(v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="truck-history.csv"');
  res.send('\uFEFF' + ['truck,plate,arrived_at,stage,flagged,logs,mean_diameter_mm,median_diameter_mm,std_mm', ...rows.map((r) => [r.id, r.plate, r.arrived_at, r.stage, r.flagged ? 'yes' : 'no', r.logs_detected, r.avg_dia, r.median_dia, r.std_dia].map(cell).join(','))].join('\n'));
});
