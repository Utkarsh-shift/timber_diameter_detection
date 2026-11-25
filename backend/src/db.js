import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(dir, { recursive: true });
export const DB_FILE = path.join(dir, 'pine.db');
export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS trucks(id TEXT PRIMARY KEY, seq INTEGER, plate TEXT, hauler TEXT, supplier_id INTEGER, po TEXT, stage TEXT, gate TEXT,
  arrived_at TEXT, logs_detected INTEGER, logs_expected INTEGER, avg_dia REAL, median_dia REAL, std_dia REAL, flagged INTEGER DEFAULT 0, flag_reason TEXT,
  inspector TEXT, gross_kg REAL, tare_kg REAL, net_kg REAL, ai_kg REAL, moisture REAL, volume REAL, progress INTEGER DEFAULT 0, committed INTEGER DEFAULT 0, species TEXT, driver TEXT);
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY, truck_id TEXT, label TEXT, major REAL, minor REAL, eq_dia REAL, area REAL, conf REAL, status TEXT, x REAL, y REAL, r REAL, edited INTEGER DEFAULT 0, occluded INTEGER DEFAULT 0, bark REAL, orig_major REAL, orig_minor REAL);
CREATE INDEX IF NOT EXISTS idx_logs_truck ON logs(truck_id);
CREATE TABLE IF NOT EXISTS log_edits(id INTEGER PRIMARY KEY, log_id INTEGER, truck_id TEXT, action TEXT, reason TEXT, operator TEXT, ts TEXT);
CREATE TABLE IF NOT EXISTS consignments(id INTEGER PRIMARY KEY, truck_id TEXT, gate TEXT, intake_time TEXT, species TEXT, geo TEXT, grade TEXT, purity REAL, defects TEXT, action TEXT, action_tone TEXT, verification TEXT, needs_review INTEGER, disposition TEXT, signed_off INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS rigs(id TEXT PRIMARY KEY, station TEXT, name TEXT, hardware TEXT, status TEXT, resolution TEXT, profile TEXT, valid_days INTEGER, reproj REAL, scale REAL, extra TEXT, image TEXT, drift REAL);
CREATE TABLE IF NOT EXISTS calib_events(id TEXT PRIMARY KEY, ts TEXT, rig_id TEXT, hardware TEXT, target TEXT, reproj REAL, scale REAL, metrologist TEXT, cert TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS models(id INTEGER PRIMARY KEY, tag TEXT, weights TEXT, stage TEXT, det_map REAL, seg_map REAL, latency REAL, mae REAL, notes TEXT);
CREATE TABLE IF NOT EXISTS gpu_nodes(id TEXT PRIMARY KEY, role TEXT, descr TEXT, status TEXT, temp REAL, vram REAL);
CREATE TABLE IF NOT EXISTS hitl(id INTEGER PRIMARY KEY, cls TEXT, cam TEXT, conf REAL, anomaly TEXT, image TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS certificates(truck_id TEXT PRIMARY KEY, uuid TEXT, issued_at TEXT, sha TEXT, sap_doc TEXT, tx_ref TEXT);
CREATE TABLE IF NOT EXISTS metrics_ts(id INTEGER PRIMARY KEY, ts INTEGER, latency REAL, fps REAL, queue INTEGER);
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
`;
db.exec(SCHEMA);

export const kvGet = (k, d = null) => { const r = get('SELECT v FROM kv WHERE k=?', k); return r ? JSON.parse(r.v) : d; };
export const kvSet = (k, v) => run('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, JSON.stringify(v));

// additive migrations so existing demo databases pick up new columns
const addCols = (table, defs) => {
  const have = new Set(all(`PRAGMA table_info(${table})`).map((c) => c.name));
  for (const [name, type] of defs) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
};
addCols('trucks', [['image', 'TEXT'], ['annotated', 'TEXT'], ['img_w', 'INTEGER'], ['img_h', 'INTEGER'], ['scale_mm_px', 'REAL'], ['scale_src', 'TEXT'], ['source', "TEXT DEFAULT 'seed'"], ['analysis', 'TEXT'], ['infer_ms', 'REAL'], ['engine', 'TEXT'], ['gt', 'TEXT']]);
addCols('logs', [['rx', 'REAL'], ['ry', 'REAL'], ['angle', 'REAL'], ['crack', 'REAL'], ['rot', 'REAL'], ['grade', 'TEXT'], ['texture_ok', 'INTEGER']]);
addCols('models', [['params', 'TEXT'], ['precision_pct', 'REAL'], ['recall_pct', 'REAL'], ['bench_at', 'TEXT']]);
addCols('rigs', [['intrinsics', 'TEXT']]);

// companies (tenants): every truck and consignment belongs to exactly one
db.exec('CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT)');
addCols('trucks', [['company_id', 'TEXT']]);
addCols('consignments', [['company_id', 'TEXT']]);
db.exec('CREATE INDEX IF NOT EXISTS idx_trucks_company ON trucks(company_id)');
if (!get('SELECT 1 x FROM companies')) {
  ['JK Paper', 'XYZ Paper'].forEach((n, i) => run('INSERT INTO companies VALUES(?,?,?)', 'c' + (i + 1), n, new Date(Date.now() + i).toISOString()));
}
// gives rows without a company one (existing demo data is spread over the seeded companies, uploads go to the first)
export const assignCompanies = () => {
  db.exec("UPDATE trucks SET company_id = CASE WHEN source='upload' THEN 'c1' ELSE 'c' || (seq % 2 + 1) END WHERE company_id IS NULL");
  db.exec("UPDATE consignments SET company_id = COALESCE((SELECT company_id FROM trucks WHERE trucks.id = consignments.truck_id), 'c1') WHERE company_id IS NULL");
};
assignCompanies();
// older demo databases had three placeholder companies; fold them into the two real ones
db.exec("UPDATE companies SET name='JK Paper' WHERE id='c1' AND name='Company A'; UPDATE companies SET name='XYZ Paper' WHERE id='c2' AND name='Company B'");
if (get("SELECT 1 x FROM companies WHERE id='c3' AND name='Company C'")) {
  db.exec("UPDATE trucks SET company_id='c' || (seq % 2 + 1) WHERE company_id='c3'; UPDATE consignments SET company_id='c1' WHERE company_id='c3'; DELETE FROM companies WHERE id='c3'");
}
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, password TEXT NOT NULL, company_id TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);`);
// the platform has a single camera feed and three stages; fold older demo databases into that shape
db.exec("UPDATE trucks SET stage='ai_inference', progress=40 WHERE stage IN ('gate_checkin','gantry_imaging'); UPDATE trucks SET stage='verification', progress=75 WHERE stage='scale_sync'; DELETE FROM rigs WHERE id!='G-01'; DELETE FROM calib_events WHERE rig_id!='G-01'; UPDATE rigs SET station='CAMERA', name='Camera', hardware='Fixed camera' WHERE id='G-01';");
