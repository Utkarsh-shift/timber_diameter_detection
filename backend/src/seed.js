import { db, run, get, all, tx, kvSet } from './db.js';
import { rng, normal, round, mean, median, std } from './util.js';

const HAULERS = ['Ahola Transport Oy', 'Polar Nordic Logistics', 'Kautokeino Timber AS', 'Kuljetus Heino Oy', 'Savon Metsäkuljetus', 'K-Logistics-FI', 'Taiga Wood Oy'];
const INSPECT = ['M. Lindqvist', 'A. Korhonen', 'J. Saarinen', 'J. Virtanen', 'K. Lindholm', 'M. Niemi'];
const GATES = ['G-01', 'G-02', 'G-03', 'G-04'];
const PLATES = ['FIN-882-XY', 'SWE-419-KL', 'FIN-104-AB', 'EST-552-RT', 'FIN-771-MN', 'FIN-603-PL'];

export function genLogs(n, meanDia, sd, seed, { lowOutliers = 0 } = {}) {
  const r = rng(seed); const out = [];
  const cols = 14, rows = 5;
  for (let i = 0; i < n; i++) {
    let d = normal(r, meanDia, sd);
    if (i % 24 === 23 && i / 24 < lowOutliers) d = 76 + r() * 13;
    d = Math.max(70, Math.min(170, d));
    const ov = 1 + Math.abs(normal(r, 0, 0.03));
    const minor = d / Math.sqrt(ov), major = d * Math.sqrt(ov);
    const slot = i % (cols * rows), cx = slot % cols, cy = Math.floor(slot / cols);
    out.push({
      label: 'LOG-' + String(i + 1).padStart(3, '0'), major: round(major), minor: round(minor), eq: round(d), area: round(Math.PI * (d / 20) ** 2, 1),
      conf: round(96 + r() * 3.9, 1), x: round(14 + (cx + 0.5 + (r() - 0.5) * 0.4) * (78 / cols), 1), y: round(36 + (cy + 0.5 + (r() - 0.5) * 0.3) * (36 / rows), 1),
      r: round(1.7 + d / 100, 2), occluded: r() < 0.03 ? 1 : 0, bark: round(1 + r() * 2.5, 1),
    });
  }
  return out;
}

export function insertLogs(truckId, logs) {
  const st = db.prepare('INSERT INTO logs(truck_id,label,major,minor,eq_dia,area,conf,status,x,y,r,occluded,bark,orig_major,orig_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const l of logs) st.run(truckId, l.label, l.major, l.minor, l.eq, l.area, l.conf, l.eq < 90 ? 'FLAGGED' : 'VALID', l.x, l.y, l.r, l.occluded, l.bark, l.major, l.minor);
}

export function refreshTruckStats(truckId) {
  const rows = all("SELECT eq_dia FROM logs WHERE truck_id=? AND status!='REJECTED'", truckId).map((x) => x.eq_dia);
  if (!rows.length) return;
  run('UPDATE trucks SET logs_detected=?, avg_dia=?, median_dia=?, std_dia=? WHERE id=?', rows.length, round(mean(rows)), round(median(rows)), round(std(rows)), truckId);
}

const PROGRESS = { ai_inference: 40, verification: 75, completed: 100 };
export const STAGES = ['ai_inference', 'verification', 'completed'];
export const progressFor = (s) => PROGRESS[s];

export function seed() {
  const r = rng(42);
  tx(() => {

    const stageFor = (i) => i < 37 ? 'completed' : i < 41 ? 'verification' : 'ai_inference';
    for (let i = 0; i < 48; i++) {
      const seq = 9800 + i, id = 'TRK-' + seq;
      let sup = 1 + Math.floor(r() * 6), stage = stageFor(i), flagged = 0, reason = null;
      let n = 280 + Math.floor(r() * 80), md = 120 + r() * 18, sdv = 11 + r() * 4, lowO = 0;
      if (seq === 9840) { sup = 1; stage = 'completed'; n = 340; md = 131.0; sdv = 13.6; }
      if (seq === 9841) { sup = 5; stage = 'verification'; flagged = 1; reason = 'Under-gauge (-5.5mm)'; n = 288; md = 114.5; sdv = 12.8; lowO = 10; }
      if (seq === 9842) { sup = 2; stage = 'completed'; }
      if (seq === 9837) { sup = 4; flagged = 1; reason = 'Bark volume discrepancy'; stage = 'completed'; }
      const s = { species: ['Pinus sylvestris', 'Picea abies', 'Betula pendula'][sup % 3] };
      const t = new Date(new Date().setHours(0, 0, 0, 0) - 6 * 86400000 + 3 * 3600000 + i * 205 * 60000 + Math.floor(r() * 5) * 60000).toISOString();
      const logs = genLogs(n, md, sdv, 1000 + seq, { lowOutliers: lowO });
      const net = Math.round(n * (96 + r() * 18)), gross = net + 15770;
      run('INSERT INTO trucks(id,seq,plate,hauler,supplier_id,po,stage,gate,arrived_at,logs_detected,logs_expected,flagged,flag_reason,inspector,gross_kg,tare_kg,net_kg,ai_kg,moisture,volume,progress,committed,species,driver) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id, seq, PLATES[i % 6].replace(/\d{3}/, String(100 + ((i * 37) % 900))), HAULERS[i % HAULERS.length], null, null, stage, GATES[i % 4], t, n, n - Math.floor(r() * 12), flagged, reason,
        INSPECT[i % INSPECT.length], gross, 15770, net, Math.round(net * (0.995 + r() * 0.01)), round(42 + r() * 6, 1), round(net / 800, 1), PROGRESS[stage], stage === 'completed' ? 1 : 0, s.species, ['Erik Salo', 'T. Mäkelä', 'P. Heino'][i % 3]);
      insertLogs(id, logs); refreshTruckStats(id);
      if (stage === 'completed') run('INSERT INTO certificates VALUES(?,?,?,?,?,?)', id, `#PINE-CERT-2024-10-${seq}`, t, [...Array(8)].map(() => Math.floor(r() * 65536).toString(16).padStart(4, '0')).join(''), `#${8839104 + i}`, `#SAP-GR-${9012488 + i}`);
    }
    run("UPDATE logs SET major=91.2, minor=84.8, eq_dia=88.0, area=60.8, conf=94.2, status='FLAGGED', x=47, y=56, r=3.2, occluded=0, bark=2.1, orig_major=91.2, orig_minor=84.8 WHERE truck_id='TRK-9841' AND label='LOG-042'");
    for (const id of ['TRK-9840', 'TRK-9841']) run('UPDATE trucks SET gross_kg=48220, tare_kg=15770, net_kg=32450, ai_kg=32710, moisture=44.2 WHERE id=?', id);
    refreshTruckStats('TRK-9841');

    [['TRK-8841-FI', 'GATE 1', '09:41 EEST', 'Pinus Sylvestris (Pine)', '#FI-KUO-4921', 'A', 96.4, 'None (<0.2% crack, 1.04 oval)', 'To Continuous Digester 01', 'ok', 'AI Automated (No Review Req)', 0],
     ['TRK-9012-SE', 'ATTN', '10:14 EEST', 'Picea Abies (Spruce)', '#SE-VBN-8102', 'C?', 71.0, 'Radial Crack (24mm), Rot Core 4.8%, Logs #048, #052 exceed threshold', 'Halt • Divert to Biomass', 'bad', 'PENDING HUMAN SIGN-OFF', 1],
     ['TRK-7748-FI', 'GATE 2', '10:28 EEST', 'Betula Pendula (Birch)', '#FI-KAI-3301', 'B', 91.1, 'Minor Taper (1.12 oval), 0.8% bark loss', 'To Secondary Chipper Line', 'ok', 'Auto-Accepted (Tolerance Band)', 0],
     ['TRK-8855-FI', 'ATTN', '10:45 EEST', 'Pinus Sylvestris (Pine)', '#FI-POH-1299', 'C', 62.0, 'Mean Diameter 82mm (<110mm threshold), 22% batch undersized', 'Divert to Pulp Pelletizing', 'bad', 'Awaiting Inspector Confirmation', 1]]
      .forEach((c) => run('INSERT INTO consignments(truck_id,gate,intake_time,species,geo,grade,purity,defects,action,action_tone,verification,needs_review) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ...c));


    [['G-01', 'CAMERA', 'Camera', 'Fixed camera', 'ONLINE', '4096 × 2160 (RAW12)', 'v4.2', 24, 0.12, 0.412, { Lens: 'k1=-0.04 • k2=0.002' }, 'camera_calibration_management-2.jpg', -0.041],
     ['G-02', 'STATION G-02', 'North Gate Dual 4K Scanner', 'Basler ace2 Pro Dual 4K', 'ONLINE', 'Dual 3840 × 2160 @ 60 FPS', 'v3.9', 19, 0.14, 0.415, { Baseline: '1,420.0 mm (±0.05)' }, 'camera_calibration_management-3.jpg', 0.02],
     ['G-03', 'STATION G-03', 'Weighbridge Infeed Ingest', 'Allied Vision Alvium • NIR + Optical', 'ONLINE', '2464 × 2056 Spectral', 'v5.0', 29, 0.11, 0.398, { 'NIR-RGB Registration': 'Δoffset < 0.2 px' }, 'camera_calibration_management-4.jpg', 0.01],
     ['G-04', 'STATION G-04', 'Discharge Rail Gantry', 'FLIR Blackfly S • Single Gantry High-Speed', 'RECAL DUE', '4096 × 3000 @ 74 FPS', 'v3.1', 2, 0.19, 0.428, { 'Focal Shift': 'Δfy = +3.8 px (Vibration)' }, 'camera_calibration_management-5.jpg', 0.09]]
      .filter((x) => x[0] === 'G-01').forEach((x) => run('INSERT INTO rigs(id,station,name,hardware,status,resolution,profile,valid_days,reproj,scale,extra,image,drift) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8], x[9], JSON.stringify(x[10]), x[11], x[12]));
    [['EV-90218', '2024-10-22 08:14', 'G-01', 'FLIR Ladybug6 360', 'ChArUco 12x9 40mm', 0.124, 0.412, 'M. Lindqvist (#802)', 'CERT-SHA256', 'VERIFIED'],
     ['EV-90104', '2024-10-17 14:32', 'G-03', 'Allied Vision Alvium NIR', 'Retro-Reflective Dot 15x15', 0.112, 0.398, 'T. Haataja (#419)', 'CERT-SHA256', 'VERIFIED'],
     ['EV-89945', '2024-10-12 09:05', 'G-02', 'Basler ace2 Pro Dual 4K', 'Dual Checkerboard 30mm', 0.141, 0.415, 'M. Lindqvist (#802)', 'CERT-SHA256', 'VERIFIED'],
     ['EV-88410', '2024-09-24 16:50', 'G-04', 'FLIR Blackfly S 4K', 'ChArUco 10x7 50mm', 0.179, 0.428, 'E. Rantala (#114)', 'CAL-PENDING', 'EXPIRING']]
      .filter((e) => e[2] === 'G-01').forEach((e) => run('INSERT INTO calib_events VALUES(?,?,?,?,?,?,?,?,?,?)', ...e));

    [['ellipse-v1.3-highrecall', 'OpenCV Hough + DT seeds, relaxed thresholds', 'PRODUCTION', null, null, null, null, '']]
      .forEach((m) => run('INSERT INTO models(tag,weights,stage,det_map,seg_map,latency,mae,notes) VALUES(?,?,?,?,?,?,?,?)', ...m));
    [['L40S-01', 'ACTIVE', 'Truck Gantry Intake A (Overhead RGB-D)', 51, 18.2], ['L40S-02', 'ACTIVE', 'Truck Gantry Intake B (Profile LiDAR Sync)', 53, 19.1], ['L40S-03', 'ACTIVE', 'Debarking Infeed Conveyor (Spectral)', 50, 17.8], ['L40S-04', 'STANDBY', 'Shadow Evaluator & Failover Mirror', 44, 12.4]]
      .forEach((g) => run('INSERT INTO gpu_nodes VALUES(?,?,?,?,?,?)', 'Node ' + g[0], g[2].split(' (')[0], g[2], g[1], g[3], g[4]));
    [['SNOW_OBSCURATION', 'Cam 02 • Truck #FI-882', 62.4, 'Severe Snow Crust', 'ai_model_monitoring_cv_operations-2.jpg'], ['OBLIQUE_CROSS_CUT', 'Cam 04 • Gantry Conveyor 3', 74.8, 'Non-Perpendicular Saw Cut', 'ai_model_monitoring_cv_operations-3.jpg'], ['BOUNDARY_OCCLUSION', 'Cam 01 • Weighbridge Buffer', 58.1, 'Tangent Edge Overlap', 'ai_model_monitoring_cv_operations-4.jpg']]
      .forEach((h) => run("INSERT INTO hitl(cls,cam,conf,anomaly,image,status) VALUES(?,?,?,?,?,'pending')", ...h));
    const now = Date.now();
    for (let i = 0; i < 48; i++) run('INSERT INTO metrics_ts(ts,latency,fps,queue) VALUES(?,?,?,?)', now - (48 - i) * 1800000, round(13.5 + Math.sin(i / 5) * 1.8 + r(), 1), round(56 + Math.sin(i / 4) * 3 + r() * 3, 1), Math.floor(2 + r() * 5));
  });
}
