import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { patch, post, useApi } from '../api.js';
import { Badge, Bars, Card, Icon, Loading, PageHead, Section, fmt, useToast } from '../ui.jsx';

const PIPE = ['1. INGEST', '2. CONTRAST NORM', '3. CIRCLE SEEDS', '4. RAY EDGE FIT', '5. ELLIPSE MASK', '6. DEFECT METRICS', '7. METRIC SCALE'];

export default function Studio() {
  const [sp, setSp] = useSearchParams();
  const { data: trucks } = useApi('/trucks?size=50');
  const truckId = sp.get('truck') || trucks?.items?.[0]?.id; // no truck chosen: open this company's newest one
  const { data: truck, error: truckErr } = useApi(truckId ? '/trucks/' + truckId : null);
  const { data: d, reload } = useApi(truckId ? `/trucks/${truckId}/logs` : null);
  const [sel, setSel] = useState(null); const [filter, setFilter] = useState('all'); const [q, setQ] = useState(''); const [rows, setRows] = useState(7);
  const [show, setShow] = useState({ masks: true, axes: true, ids: true }); const [zoom, setZoom] = useState(100);
  const [tab, setTab] = useState('log'); const [addMode, setAddMode] = useState(false); const [annotated, setAnnotated] = useState(false);
  const { data: rules } = useApi('/settings/rules');
  const [showGT, setShowGT] = useState(true);
  const nav = useNavigate(); const toast = useToast();

  const logs = d?.logs || [];
  useEffect(() => { if (logs.length && !logs.find((l) => l.id === sel)) setSel((logs.find((l) => l.label === 'LOG-042') || logs.find((l) => l.status === 'FLAGGED') || logs[0]).id); }, [logs, sel]);
  const cur = logs.find((l) => l.id === sel);
  const isUpload = truck?.source === 'upload';
  const shown = useMemo(() => (isUpload ? logs : logs.slice(0, 70)), [logs, isUpload]);
  const list = useMemo(() => logs.filter((l) => (filter === 'all' || (filter === 'ok' && l.status === 'VALID') || (filter === 'under' && l.status === 'FLAGGED') || (filter === 'oval' && l.major / l.minor > 1.2)) && (!q || l.label.toLowerCase().includes(q.toLowerCase()))), [logs, filter, q]);
  if (truckErr && sp.get('truck')) return <div className="flex flex-col items-center gap-3 py-24 text-center"><h1 className="text-[20px] font-semibold">Truck not found</h1><p className="text-[13px] text-[#718078]">{sp.get('truck')} does not exist for your company.</p><button className="btn btn-primary" onClick={() => setSp({})}>Open the latest truck</button></div>;
  if (trucks && !truckId) return <div className="py-24 text-center text-[13px] text-[#718078]">No trucks yet. Analyse a photo to see it here.</div>;
  if (!d || !truck) return <Loading />;
  const a = d.aggregates;

  const edit = async (action, delta) => { try { await patch('/logs/' + cur.id, { action, delta }); toast(`${cur.label}: ${action.replace('_', ' ')} applied (audit logged)`); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const commit = async () => { await post(`/trucks/${truckId}/commit`); toast(`${truckId} committed to ERP — certificate issued`); nav('/reports/' + truckId); };
  const flagTruck = async () => { await post(`/trucks/${truckId}/flag`, { reason: 'Flagged in Studio' }); toast('Truck flagged for review', 'bad'); };
  const dev = cur ? round1(cur.eq_dia - 90) : 0;
  const imgW = truck.img_w || 512, imgH = truck.img_h || 279, VH = (100 * imgH) / imgW;
  const imgSrc = annotated && truck.annotated ? truck.annotated : truck.image || '/img/ai_measurement_studio-bg0.jpg';
  const an = truck.analysis ? JSON.parse(truck.analysis) : null;
  const gtInfo = truck.gt ? JSON.parse(truck.gt) : null;
  const addAt = async (e) => {
    if (!addMode) return;
    const r = e.currentTarget.getBoundingClientRect();
    await post(`/trucks/${truckId}/logs`, { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
    toast('Missed log added (audit logged)'); setAddMode(false); reload();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3 items-stretch">
        <Card className="p-3 flex-1 min-w-[260px] flex items-center gap-3"><Icon n="local_shipping" className="text-[#718078]" />
          <div><select className="input mono font-semibold" value={truckId} onChange={(e) => setSp({ truck: e.target.value })}>{[truckId, ...(trucks?.items || []).map((t) => t.id)].filter((v, i, arr) => arr.indexOf(v) === i).map((id) => <option key={id}>{id}</option>)}</select>
            <div className="text-[11px] text-[#718078] mt-1">{truck.plate}</div></div></Card>
        <Card className="p-3 flex-1 min-w-[220px] text-[11px]"><div className="lbl">{isUpload ? 'Uploaded photo' : 'Camera'}</div><div className="mono text-[#718078]">{isUpload ? `${imgW}×${imgH}px • ${truck.scale_mm_px} mm/px` : 'Calibrated 08:00 AM • Scale 0.412 mm/px'}</div>{isUpload && <div className="mono text-[10px] text-[#718078]">{truck.scale_src}</div>}</Card>
        <Card className="p-3 flex-1 min-w-[220px] text-[11px]"><div className="lbl flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#a4c66c] pulse-dot" />Review</div><div className="mono text-[#718078]">AI Pass: {a.total} Detections • {truck.engine || 'ellipse-v1'}{an ? ` • ${an.timing.inference_ms} ms` : ''}</div></Card>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button className={`btn ${addMode ? 'btn-primary' : ''}`} onClick={() => { setAddMode(!addMode); if (!addMode) toast('Click on the image where a log end was missed'); }}><Icon n="add" />Add Missed</button>
        {truck.annotated && <button className={`btn ${annotated ? 'btn-primary' : ''}`} onClick={() => setAnnotated(!annotated)}><Icon n="layers" />Server annotation: {annotated ? 'ON' : 'OFF'}</button>}
        <button className="btn btn-danger" onClick={flagTruck}><Icon n="flag" />Flag</button>
        <a className="btn" href={`/api/reports/${truckId}/csv`}><Icon n="download" />Export CSV</a>
        <div className="flex-1" />
        <button className="btn btn-primary" onClick={commit}><Icon n="check_circle" />Approve & Commit</button>
      </div>
      {gtInfo && <Card className="p-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] border-[#ffb02088]"><Badge tone="warn">GROUND TRUTH</Badge><span className="text-[#414845]">{gtInfo.eval.gt} labelled log ends in this photo • {gtInfo.eval.detected} detected</span>{[['Precision', gtInfo.eval.precision + '%'], ['Recall', gtInfo.eval.recall + '%'], ['F1', gtInfo.eval.f1 + '%'], ['Matched box IoU', gtInfo.eval.mean_iou != null ? gtInfo.eval.mean_iou + '%' : '–'], ['Ø vs GT box', gtInfo.eval.diameter_ratio ?? '–']].map(([k, v]) => <span key={k}><span className="lbl mr-1">{k}</span><b className="mono">{v}</b></span>)}<button className={`btn ml-auto ${showGT ? 'btn-primary' : ''}`} onClick={() => setShowGT(!showGT)}><Icon n="rule" />GT boxes: {showGT ? 'ON' : 'OFF'}</button></Card>}

      <div className="grid xl:grid-cols-[1fr_380px] gap-4">
        <div className="flex flex-col gap-2">
          <Card className="p-2 flex flex-wrap items-center gap-2 text-[12px]">
            <button className="btn" onClick={() => setZoom(Math.max(60, zoom - 20))}><Icon n="remove" /></button><span className="mono">{zoom}%</span><button className="btn" onClick={() => setZoom(Math.min(200, zoom + 20))}><Icon n="add" /></button>
            {[['masks', 'Masks'], ['axes', 'Axes'], ['ids', 'IDs']].map(([k, l]) => <button key={k} onClick={() => setShow({ ...show, [k]: !show[k] })} className={`btn ${show[k] ? 'btn-primary' : ''}`}>{l}: {show[k] ? 'ON' : 'OFF'}</button>)}
          </Card>
          <div className="relative overflow-auto bg-black rounded-lg border border-[#17241f]" style={{ maxHeight: 520 }}>
            <div className={`relative ${addMode ? 'cursor-crosshair' : ''}`} style={{ width: zoom + '%', aspectRatio: `${imgW}/${imgH}` }} onClick={addAt}>
              <img src={imgSrc} className="absolute inset-0 w-full h-full object-cover" alt="gantry feed" />
              <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.12)' }} />
              <svg viewBox={`0 0 100 ${VH}`} className={`absolute inset-0 w-full h-full ${annotated ? 'hidden' : ''}`}>
                {gtInfo && showGT && gtInfo.boxes.map((g, i) => <rect key={'gt' + i} x={g[0]} y={(g[1] * VH) / 100} width={g[2]} height={(g[3] * VH) / 100} fill="none" stroke="#ffb020" strokeWidth="0.25" />)}
                {shown.map((l) => {
                  const y = (l.y * VH) / 100, bad = l.status === 'FLAGGED', rej = l.status === 'REJECTED', sel_ = l.id === sel;
                  if (rej) return null;
                  const geo = l.rx != null ? { rx: l.rx, ry: l.ry, rot: l.angle || 0 } : { rx: l.r * (l.major / l.eq_dia), ry: l.r * (l.minor / l.eq_dia), rot: 0 };
                  const big = Math.max(geo.rx, geo.ry);
                  return <g key={l.id} onClick={(e) => { if (!addMode) { e.stopPropagation(); setSel(l.id); } }} className="cursor-pointer">
                    {show.masks && <ellipse cx={l.x} cy={y} rx={geo.rx} ry={geo.ry} transform={`rotate(${geo.rot} ${l.x} ${y})`} fill={bad ? 'rgba(201,76,76,.25)' : 'rgba(164,198,108,.10)'} stroke={bad ? '#c94c4c' : '#a4c66c'} strokeWidth={sel_ ? 0.45 : 0.2} />}
                    {show.axes && sel_ && <><line x1={l.x - big} x2={l.x + big} y1={y} y2={y} stroke="#fff" strokeWidth="0.15" /><line x1={l.x} x2={l.x} y1={y - big} y2={y + big} stroke="#fff" strokeWidth="0.15" /></>}
                    {show.ids && (sel_ || (bad && !isUpload)) && <g><rect x={l.x - 9} y={y - big - 3.2} width="18" height="2.8" fill={bad ? '#c94c4c' : '#173f35'} /><text x={l.x} y={y - big - 1.2} fontSize="1.6" fill="#fff" textAnchor="middle" fontFamily="JetBrains Mono">{l.label} | {l.eq_dia}mm{bad ? ' ⚠' : ''}</text></g>}
                  </g>;
                })}
              </svg>
              <div className="absolute top-2 left-2 mono text-[9px] bg-[#17241fcc] text-white px-1.5 py-0.5 rounded-sm flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#c94c4c]" />{isUpload ? `UPLOADED PHOTO • ${truck.engine}` : 'DEMO DATA'}</div>
              <div className="absolute top-2 right-2 mono text-[9px] bg-[#a4c66c] text-[#173f35] px-1.5 py-0.5 rounded-sm">DETECTION COUNT: {a.total}/{a.total} LOGS</div>
              <div className="absolute bottom-2 left-2 right-2 mono text-[9px] bg-[#17241fcc] text-white px-2 py-1 rounded-sm flex gap-3 flex-wrap"><span>● Metric scale: {truck.scale_mm_px || 0.412} mm/px</span><span className="text-[#a4c66c]">Compliant ({a.valid})</span><span className="text-[#ff9a9a]">Under-spec ({a.flagged})</span><span>Ovality &gt;1.2 ({a.ovality})</span></div>
            </div>
          </div>
          <div className="mono text-[10px] text-[#718078]">{isUpload ? `Photo ${imgW}×${imgH}px • ${truck.scale_src} • engine ${truck.engine} • ${an?.timing.inference_ms} ms inference • log length ${an?.summary.log_length_m} m` : ''}</div>
        </div>

        <div className="flex flex-col gap-3">
          <Card>
            <div className="flex border-b border-[#e2e8e2] text-[12px] font-semibold">{[['log', `Selected Log (${cur?.label || ''})`], ['agg', 'Truck Aggregates'], ['rules', 'Quality Rules']].map(([k, l], i) => <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 text-center ${tab === k ? 'bg-[#173f35] text-white' : ''} ${i === 0 ? 'rounded-tl-lg' : ''}`}>{l}</button>)}</div>
            {tab === 'agg' && <div className="p-4 flex flex-col gap-2 text-[12px]"><Row l="Logs (valid / flagged)" v={`${a.valid} / ${a.flagged}`} /><Row l="Mean / median Ø" v={`${a.mean} / ${a.median} mm`} /><Row l="Std dev" v={`${a.std} mm`} /><Row l="Avg bark" v={a.avg_bark != null ? a.avg_bark + '%' : '–'} /><Row l="Avg crack length" v={a.avg_crack != null ? a.avg_crack + '% of Ø' : 'n/a (resolution)'} /><Row l="Avg heart-rot" v={a.avg_rot != null ? a.avg_rot + '%' : 'n/a (resolution)'} />{a.grades?.some((g) => g.n) && <div className="flex gap-1 mt-1">{a.grades.map((g) => <Badge key={g.g} tone={g.g === 'A' ? 'ok' : g.g === 'B' ? 'info' : 'bad'}>Grade {g.g}: {g.n}</Badge>)}</div>}</div>}
            {tab === 'rules' && rules && <div className="p-4 flex flex-col gap-2 text-[12px]"><Row l="Grade A minimum Ø" v={`${rules.grade_a_min_mm} mm`} /><Row l="Grade B minimum Ø" v={`${rules.grade_b_min_mm} mm`} /><Row l="Max crack length (A)" v={`${rules.max_crack_pct}% of Ø`} /><Row l="Max ovality (A)" v={rules.max_ovality} /><Row l="Reject if heart-rot ≥" v={`${rules.reject_rot_pct}%`} /><p className="text-[11px] text-[#718078]">Edit these on the Quality screen (Edit thresholds).</p></div>}
            {tab === 'log' && cur && <div className="p-4 flex flex-col gap-3">
              <div className="flex gap-3 items-center"><img src="/img/ai_measurement_studio-2.jpg" className="w-14 h-14 rounded object-cover border border-[#e2e8e2]" alt="" /><div className="flex-1"><div className="flex items-center gap-2"><b className="text-[16px]">{cur.label}</b>{cur.status === 'FLAGGED' && <Badge tone="bad">SUB-GAUGE FLAG</Badge>}{cur.status === 'REJECTED' && <Badge>FALSE POSITIVE</Badge>}{cur.edited === 1 && <Badge tone="info">EDITED</Badge>}</div></div><div className="text-right"><div className="lbl">AI Confidence</div><div className="mono text-[16px] font-semibold">{cur.conf}%</div></div></div>
              <div className="grid grid-cols-3 gap-2 bg-[#f5f7f5] p-3 rounded">
                <M l="Major axis" v={cur.major} u="mm" /><M l="Minor axis" v={cur.minor} u="mm" /><M l="Eq. diameter" v={cur.eq_dia} u="mm" tone={cur.status === 'FLAGGED' ? 'bad' : ''} sub={cur.status === 'FLAGGED' ? 'Under Target' : 'In range'} />
              </div>
              <Row l="Cross-section area" v={`${cur.area} cm²`} /><Row l="Ovality ratio (A/B)" v={`${(cur.major / cur.minor).toFixed(2)} (${cur.major / cur.minor > 1.2 ? 'High' : 'Normal'})`} /><Row l="Visibility score" v={cur.occluded ? '82% (Occluded)' : '100% (Unoccluded)'} /><Row l="Bark inclusion ratio" v={`${cur.bark}%`} />{cur.grade && <Row l="AI grade" v={cur.grade === 'R' ? 'REJECT' : 'Grade ' + cur.grade} />}{cur.texture_ok === 1 && <><Row l="Crack length (% of Ø)" v={`${cur.crack}%`} /><Row l="Heart-rot (% of face)" v={`${cur.rot}%`} /></>}
              {cur.status === 'FLAGGED' && <div className="bg-[#ffdad6] border border-[#c94c4c44] rounded p-3 text-[12px] text-[#8a1e1e]"><b>Sub-gauge log</b><div>{cur.eq_dia} mm is below the {rules?.grade_b_min_mm ?? 90} mm minimum.</div></div>}
              <div className="bg-[#f5f7f5] rounded p-3 flex flex-col gap-2"><div className="flex justify-between"><span className="lbl">Inspector manual adjustment</span></div>
                <div className="grid grid-cols-2 gap-2"><button className="btn justify-center" onClick={() => edit('nudge', 1)}><Icon n="open_with" />Nudge Ellipse (±1px)</button><button className="btn justify-center" onClick={() => edit('diameter', 1)}><Icon n="expand" />Diameter (+1mm)</button><button className="btn justify-center" onClick={() => edit('exclude_bark')}><Icon n="crop_free" />Exclude Bark Ring</button><button className="btn justify-center" onClick={() => edit('false_positive')}><Icon n="delete" />Mark False Positive</button></div>
                <div className="flex justify-end gap-2"><button className="btn" onClick={() => edit('reset')}>Reset AI Fit</button></div></div>
            </div>}
          </Card>
        </div>
      </div>

      <Section title="Intake Truck Aggregates" right={<Badge tone="ok">{a.total} TOTAL LOGS</Badge>}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4"><Agg l="Mean diam" v={a.mean} u="mm" /><Agg l="Median diam" v={a.median} u="mm" s={`StdDev: ${a.std} mm`} /><Agg l="Min / Max" v={`${a.min} / ${a.max}`} u="mm" s={`Spread: ${round1(a.max - a.min)} mm`} /></div>
        <div className="grid md:grid-cols-2 gap-4"><div><div className="lbl mb-2">Diameter distribution (N={a.total})</div><Bars data={a.hist.map((h) => ({ l: h.from, v: h.count }))} height={130} red={(x) => x.l < 90} /></div>
          <div><div className="lbl mb-2">Major vs Minor aspect (ideal 1.0)</div><svg viewBox="0 0 200 100" className="w-full h-[130px] bg-[#f5f7f5] rounded"><line x1="10" y1="90" x2="190" y2="10" stroke="#c0c8c4" strokeDasharray="3" />{logs.slice(0, 120).map((l) => <circle key={l.id} cx={10 + ((l.minor - 70) / 100) * 180} cy={90 - ((l.major - 70) / 100) * 80} r="1.3" fill={l.status === 'FLAGGED' ? '#c94c4c' : '#245b49'} />)}</svg><div className="mono text-[10px] text-[#718078] text-right">{a.within_ovality}% within 1.2 limit</div></div></div>
        <div className="mt-3 text-[12px] bg-[#e7f7ee] rounded p-2 flex justify-between"><span>✔ Valid Measurements: {a.valid + a.flagged} / {a.total} ({a.edits} manual edits logged)</span><span className="mono text-[#718078]">{a.occluded} Occluded</span></div>
      </Section>

      <Card>
        <div className="p-3 flex flex-wrap gap-2 items-center border-b border-[#e2e8e2]"><input className="input w-64" placeholder="Filter by log ID (e.g., LOG-042)…" value={q} onChange={(e) => setQ(e.target.value)} />
          {[['all', `All (${a.total})`], ['ok', `Compliant (${a.valid})`], ['under', `Flagged (${a.flagged})`], ['oval', `Ovality >1.2 (${a.ovality})`]].map(([k, l]) => <button key={k} className={`btn ${filter === k ? 'btn-primary' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
          <span className="flex-1" /><span className="lbl">Showing 1-{Math.min(rows, list.length)} of {list.length} records</span><a className="btn" href={`/api/reports/${truckId}/csv`}><Icon n="download" />Export CSV</a></div>
        <div className="overflow-x-auto"><table className="dt"><thead><tr><th>Log ID</th><th>Status</th><th>Major (mm)</th><th>Minor (mm)</th><th>Eq. Diam (mm)</th><th>Area (cm²)</th><th>Grade</th><th>AI Conf</th><th>Visibility</th><th>Quality Assessment</th><th /></tr></thead>
          <tbody>{list.slice(0, rows).map((l) => <tr key={l.id} className={l.status === 'FLAGGED' ? 'bg-[#c94c4c0a]' : l.id === sel ? 'bg-[#e7f7ee]' : ''}>
            <td className="mono">{l.label}</td><td><Badge tone={l.status === 'VALID' ? 'ok' : l.status === 'FLAGGED' ? 'bad' : 'mute'}>{l.status}</Badge></td><td className="mono">{l.major}</td><td className="mono">{l.minor}</td><td className="mono font-semibold">{l.eq_dia}</td><td className="mono">{l.area}</td><td className="mono">{l.grade || '–'}</td><td className="mono">{l.conf}%</td><td className="mono">{l.occluded ? '82%' : '100%'}</td>
            <td className="text-[11px]">{l.status === 'FLAGGED' ? <span className="text-[#c94c4c]">⚠ Sub-gauge (&lt;90 mm PO Threshold)</span> : l.status === 'REJECTED' ? 'Excluded' : 'Grade 1 Compliant'}</td><td><button className="btn" onClick={() => { setSel(l.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{l.status === 'FLAGGED' ? 'Review' : <Icon n="edit" />}</button></td></tr>)}</tbody></table></div>
        <div className="flex items-center justify-end gap-2 p-2 text-[11px] text-[#718078]">Row display: <select className="input" value={rows} onChange={(e) => setRows(+e.target.value)}>{[7, 25, 100].map((n) => <option key={n}>{n}</option>)}</select></div>
      </Card>
    </div>
  );
}
const round1 = (n) => Math.round(n * 10) / 10;
const M = ({ l, v, u, tone, sub }) => <div><div className="lbl">{l}</div><div className={`mono text-[20px] font-semibold ${tone === 'bad' ? 'text-[#c94c4c]' : ''}`}>{v}<span className="text-[11px] text-[#718078] ml-0.5">{u}</span></div>{sub && <div className={`mono text-[10px] ${tone === 'bad' ? 'text-[#c94c4c]' : 'text-[#245b49]'}`}>{sub}</div>}</div>;
const Row = ({ l, v }) => <div className="flex justify-between text-[12px] border-b border-[#f0f3f0] py-1"><span className="text-[#718078]">{l}</span><span className="mono">{v}</span></div>;
const Agg = ({ l, v, u, s }) => <Card className="p-3 bg-[#f5f7f5]"><div className="lbl">{l}</div><div className="mono text-[22px] font-semibold">{v}<span className="text-[11px] text-[#718078] ml-1">{u}</span></div><div className="mono text-[10px] text-[#718078]">{s}</div></Card>;
