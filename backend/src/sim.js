import { all, get, run } from './db.js';
import { broadcast } from './events.js';
import { advanceTruck } from './api.js';
import { genLogs, insertLogs, refreshTruckStats } from './seed.js';
import { round } from './util.js';

// Simulated edge-ingest: trucks move through the pipeline, CV logs appear, telemetry jitters.
export function startSim() {
  setInterval(() => {
    // simulated trucks get their detections when they reach AI inference
    for (const t of all("SELECT * FROM trucks WHERE stage='ai_inference' AND logs_detected=0")) {
      const n = 280 + Math.floor(Math.random() * 60), md = 118 + Math.random() * 18;
      insertLogs(t.id, genLogs(n, md, 11 + Math.random() * 4, Date.now() % 100000));
      refreshTruckStats(t.id);
      const net = Math.round(n * (96 + Math.random() * 18));
      run('UPDATE trucks SET net_kg=?, gross_kg=?, ai_kg=?, volume=?, moisture=? WHERE id=?', net, net + 15770, Math.round(net * 1.003), round(net / 800, 1), round(42 + Math.random() * 6, 1), t.id);
    }
    // flagged trucks wait for a human in the Studio; everything else flows through on its own
    const live = all("SELECT * FROM trucks WHERE stage!='completed' AND flagged=0 AND logs_detected>0 ORDER BY seq");
    if (live.length) advanceTruck(live[Math.floor(Math.random() * live.length)].id);
    const yard = get("SELECT COUNT(*) c FROM trucks WHERE stage!='completed'").c;
    if (yard < 8 && Math.random() < 0.5) {
      const seq = get('SELECT MAX(seq) m FROM trucks').m + 1, sup = 1 + Math.floor(Math.random() * 6);
      const s = { species: ['Pinus sylvestris', 'Picea abies', 'Betula pendula'][sup % 3] };
      run('INSERT INTO trucks(id,seq,plate,hauler,supplier_id,po,stage,gate,arrived_at,logs_detected,logs_expected,inspector,gross_kg,tare_kg,net_kg,ai_kg,moisture,volume,progress,species,driver) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        'TRK-' + seq, seq, `FIN-${100 + (seq * 7) % 900}-${'ABKLMNRTXY'[seq % 10]}${'BCDGHJKP'[seq % 8]}`, 'Ahola Transport Oy', null, null, 'ai_inference', 'G-0' + (1 + seq % 4), new Date().toISOString(), 0, 300, 'AUTO GATE', 0, 15770, 0, 0, 0, 0, 40, s.species, 'Erik Salo');
      const cs = all('SELECT id FROM companies'); run('UPDATE trucks SET company_id=? WHERE id=?', cs[Math.floor(Math.random() * cs.length)].id, 'TRK-' + seq);
    }
    const lat = round(13.5 + Math.random() * 2.5, 1), fps = round(57 + Math.random() * 5, 1);
    run('INSERT INTO metrics_ts(ts,latency,fps,queue) VALUES(?,?,?,?)', Date.now(), lat, fps, yard);
    run('DELETE FROM metrics_ts WHERE id < (SELECT MAX(id) FROM metrics_ts) - 96');
    for (const g of all("SELECT * FROM gpu_nodes WHERE status='ACTIVE'")) run('UPDATE gpu_nodes SET temp=?, vram=? WHERE id=?', round(g.temp + (Math.random() - 0.5) * 2, 0), round(g.vram + (Math.random() - 0.5) * 0.4, 1), g.id);
    broadcast('tick', { lat, fps });
  }, 6000);
}
