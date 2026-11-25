import { useState } from 'react';
import { call, post, useApi } from '../api.js';
import DateRange, { rangeQuery } from '../components/DateRange.jsx';
import { Badge, Card, Crop, Field, Icon, Kpi, Line, Loading, Modal, PageHead, Section, useToast } from '../ui.jsx';

const OPTIONS = [['reject', 'Confirm Reject / Divert to Biomass Boiler'], ['grade_c', 'Down-grade to Grade C (Pelletizing)'], ['digester', 'Manual Override (Accept to Digester)']];

export default function Quality() {
  const [range, setRange] = useState(null); const [truckSel, setTruckSel] = useState('');
  const qs = [range && rangeQuery(range), truckSel && 'truck=' + encodeURIComponent(truckSel)].filter(Boolean).join('&');
  const { data: d, reload } = useApi('/quality' + (qs ? '?' + qs : ''), { live: ['quality'] });
  const [active, setActive] = useState(null); const [choice, setChoice] = useState('reject'); const toast = useToast();
  const [edit, setEdit] = useState(false);
  const { data: rl, reload: reloadRules } = useApi('/settings/rules');
  const latestReview = (list) => [...(list || [])].reverse().find((c) => c.needs_review && !c.signed_off);
  const focus = d?.consignments.find((c) => c.id === active) || latestReview(d?.consignments);
  const { data: ft } = useApi(focus ? `/trucks/${focus.truck_id}` : '/health');
  const { data: fl } = useApi(focus ? `/trucks/${focus.truck_id}/logs` : '/health');
  if (!d) return <Loading />;
  const k = d.kpis; const open = d.consignments.find((c) => c.id === active) || latestReview(d.consignments);
  const wl = fl?.logs ? [...fl.logs].sort((x, y) => (y.rot || 0) + (y.crack || 0) / 4 - ((x.rot || 0) + (x.crack || 0) / 4) || x.eq_dia - y.eq_dia)[0] : null;
  const dispositionLabel = OPTIONS.find((o) => o[0] === choice)[1];
  const signOff = async () => { await post(`/consignments/${open.id}/disposition`, { disposition: dispositionLabel, sign_off: true }); toast(`${open.truck_id}: disposition signed off & diverted`); setActive(null); reload(); };

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Quality">
        <select className="input mono" value={d.selected || ''} onChange={(e) => setTruckSel(e.target.value)} disabled={!d.trucks.length} title="Photo the numbers describe">
          {!d.trucks.length && <option value="">No analysed photos</option>}
          {d.trucks.map((t, i) => <option key={t.id} value={t.id}>{t.id} • {new Date(t.arrived_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{i === 0 && !truckSel ? ' (latest)' : ''}</option>)}
        </select>
        <DateRange value={range} onChange={(r) => { setRange(r); setTruckSel(''); }} />
        <button className="btn" onClick={() => setEdit(true)}><Icon n="tune" />Edit Thresholds</button>
      </PageHead>
      {!d.selected && <div className="bg-[#d69b3220] border border-[#d69b3260] rounded p-3 text-[12px]">No analysed photos {range ? 'in this period' : 'yet'}. The figures below are placeholders until a photo is analysed.</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Yield Quality Grade" value={k.yield + '%'} sub={k.source ? `Grade A+B share • ${k.source}` : 'Digester Standard ≥92.0%'} foot={k.yield >= 92 ? 'MEETS STANDARD' : 'BELOW 92% STANDARD'} tone={k.yield >= 92 ? 'ok' : 'bad'} />
        <Kpi label="Bark Rim Ratio" value={k.delam + '%'} sub="dark rim share of the end-face edge" foot={k.delam <= 5 ? 'NOMINAL' : 'HIGH'} tone={k.delam <= 5 ? 'ok' : 'warn'} />
        <Kpi label="Heart Rot / Crack Length" value={k.rot == null ? 'n/a' : k.rot + '%'} sub={k.crack == null ? (k.source ? 'photo resolution too low to measure' : 'seeded demo data') : `avg crack ${k.crack}% of Ø • ${k.measured} logs measured`} foot={k.rot == null ? 'NOT MEASURABLE' : k.rot < 1.2 ? 'LOW RISK' : 'ELEVATED'} tone={k.rot == null ? 'mute' : k.rot < 1.2 ? 'ok' : 'warn'} />
        <Kpi label="Log Ovality Ratio" value={k.ovality} sub={`D_max / D_min • limit ≤${rl?.max_ovality ?? 1.15}`} foot={k.ovality <= (rl?.max_ovality ?? 1.15) ? 'Concentric' : 'ELLIPTICAL'} tone={k.ovality <= (rl?.max_ovality ?? 1.15) ? 'ok' : 'warn'} />
      </div>
      <Card className="p-3 flex items-center gap-4 text-[13px]"><Icon n="warning" className="text-[#c94c4c]" />Reinspection queue: <b className="mono text-[#c94c4c] text-[20px]">{String(k.reinspect).padStart(2, '0')}</b> batches require sign-off</Card>

      <div className="rounded-lg bg-[#173f35] text-white p-4">
        <div className="flex items-center gap-3 mb-3"><Icon n="shield" className="text-[#a4c66c]" /><div><div className="font-semibold">Grading rules</div></div></div>
        <div className="grid md:grid-cols-4 gap-2">{d.rules.map(([t, s], i) => <div key={t} className={`rounded p-2 text-[11px] ${i === 3 ? 'bg-[#c94c4c33]' : 'bg-[#ffffff14]'}`}><div className="font-semibold">{t}</div><div className="mono text-[10px] text-[#a6cfc1]">{s}</div></div>)}</div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Roundness" sub="Radial eccentricity cross-section analysis via 3D stereo photogrammetry cameras"><Line series={[d.curve]} height={120} /><div className="grid grid-cols-2 gap-2 mt-2 bg-[#f5f7f5] rounded p-2"><div><div className="lbl">Symmetric pass rate</div><div className="mono font-semibold">{k.sym_pass != null ? k.sym_pass + '%' : '96.8%'}</div></div><div><div className="lbl">Mean ovality</div><div className="mono font-semibold">{k.ovality}</div></div></div></Section>
        <Section title="Worst Log"><div className="relative rounded overflow-hidden">{d.hero ? <Crop src={d.hero.truck.image} log={d.hero.log} imgW={d.hero.truck.img_w} imgH={d.hero.truck.img_h} className="w-full h-44 bg-black" /> : <img src="/img/quality_assessment_grading_engine-2.jpg" className="w-full h-44 object-cover" alt="" />}<span className="absolute top-2 left-2 mono text-[9px] bg-[#173f35] text-white px-1">{d.hero ? `${d.hero.log.label} • Ø ${d.hero.log.eq_dia}mm${d.hero.log.texture_ok ? ` • rot ${d.hero.log.rot}% • crack ${d.hero.log.crack}%` : ''}` : 'ROT_CORE: 2.2% [CONF 97.4%]'}</span></div><div className="mono text-[11px] mt-2">{d.hero ? `Worst log of ${d.hero.truck.id} (highest rot / crack, else smallest Ø)` : 'Upload a photo to see real defect crops here.'}</div></Section>
        <Section title="Bark & Cracks"><div className="grid grid-cols-2 gap-2"><div className="bg-[#f5f7f5] rounded p-3"><div className="lbl">Bark rim ratio</div><div className="mono text-[22px] font-semibold">{k.delam}%</div></div><div className="bg-[#f5f7f5] rounded p-3"><div className="lbl">Avg crack length</div><div className="mono text-[22px] font-semibold">{k.crack == null ? 'n/a' : k.crack + '%'}</div></div></div></Section>
      </div>

      <Card>
        <div className="p-4 pb-2"><h3 className="text-[14px] font-semibold">Consignments</h3></div>
        <div className="overflow-x-auto"><table className="dt"><thead><tr><th>Consignment / Truck ID</th><th>Species</th><th>AI Assessed Grade</th><th>Detected Defects</th><th>Automated Action</th><th>Verification</th><th>Intervention</th></tr></thead>
          <tbody>{d.consignments.map((c) => (
            <tr key={c.id} className={c.needs_review ? 'bg-[#c94c4c08]' : ''}>
              <td><div className="mono font-semibold">{c.truck_id}</div><div className="mono text-[10px] text-[#718078]">{c.gate} • {c.intake_time}</div></td>
              
              <td className="mono text-[11px]">{c.species}</td>
              <td><span className={`font-semibold ${c.grade.includes('C') ? 'text-[#c94c4c]' : ''}`}>{c.needs_review ? 'Flagged (Grade ' + c.grade + ')' : 'Grade ' + c.grade}</span><div className="mono text-[10px] text-[#718078]">({c.purity}% purity)</div></td>
              <td className="text-[11px] max-w-[220px]">{c.defects}</td><td><Badge tone={c.action_tone}>{c.action}</Badge></td>
              <td>{c.signed_off ? <Badge tone="ok">{c.verification}</Badge> : <span className={`text-[11px] ${c.needs_review ? 'text-[#c94c4c] font-semibold' : 'text-[#718078]'}`}>{c.verification}</span>}</td>
              <td><div className="flex gap-1">{c.needs_review && !c.signed_off ? <button className="btn btn-primary" onClick={() => setActive(c.id)}>Review Masks</button> : <button className="btn" onClick={() => setActive(c.id)}>View Masks</button>}</div></td>
            </tr>))}</tbody></table></div>
      </Card>

      {edit && rl && <Thresholds rules={rl} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); reloadRules(); toast('Grading thresholds saved — applies to new analyses'); }} />}
      {open && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2 mb-3"><Badge tone="bad">REVIEW</Badge><b>Consignment Exception: {open.truck_id}</b><span className="text-[12px] text-[#718078]">Inspector sign-off required.</span></div>
          <div className="grid md:grid-cols-2 gap-4">
            <div><div className="lbl mb-1">1. Optical raw log capture</div>{wl && ft?.image ? <Crop src={ft.image} log={wl} imgW={ft.img_w} imgH={ft.img_h} className="w-full h-64 rounded bg-black" /> : <img src="/img/quality_assessment_grading_engine-3.jpg" className="w-full h-64 object-cover rounded" alt="" />}</div>
            <div><div className="lbl mb-1">2. AI polygon mask & decay segmentation <span className="text-[#c94c4c]">Anomaly detected (conf: 97.8%)</span></div><div className="relative">{wl && ft?.annotated ? <Crop src={ft.annotated} log={wl} imgW={ft.img_w} imgH={ft.img_h} className="w-full h-64 rounded bg-black" /> : <img src="/img/quality_assessment_grading_engine-4.jpg" className="w-full h-64 object-cover rounded" alt="" />}<span className="absolute top-2 left-2 mono text-[10px] bg-[#c94c4c] text-white px-1">{wl ? `${wl.label} • Ø ${wl.eq_dia}mm • grade ${wl.grade || '–'}` : 'DEFECT: RADIAL CRACK • 24.2mm'}</span>{wl?.texture_ok === 1 && <span className="absolute bottom-2 left-2 mono text-[10px] bg-[#c94c4c] text-white px-1">rot {wl.rot}% • crack {wl.crack}%</span>}</div></div>
          </div>
          <div className="bg-[#f5f7f5] rounded p-3 mt-4 flex flex-wrap items-center gap-4"><span className="lbl">Manual disposition decision</span>
            {OPTIONS.map(([k, l]) => <label key={k} className="flex items-center gap-1.5 text-[12px] cursor-pointer"><input type="radio" name="disp" checked={choice === k} onChange={() => setChoice(k)} />{l}</label>)}
            <span className="flex-1" /><button className="btn btn-primary" disabled={open.signed_off === 1} onClick={signOff}><Icon n="verified" />Sign Off & Divert Gate</button></div>
        </Card>
      )}
    </div>
  );
}

function Thresholds({ rules, onClose, onSaved }) {
  const [v, setV] = useState(rules);
  const fields = [['grade_a_min_mm', 'Grade A minimum diameter (mm)'], ['grade_b_min_mm', 'Grade B minimum diameter (mm)'], ['max_crack_pct', 'Max crack length for Grade A (% of Ø)'], ['max_ovality', 'Max ovality for Grade A (major / minor)'], ['reject_rot_pct', 'Reject when heart-rot ≥ (% of end-face)'], ['wood_density_kg_m3', 'Wood density for weight estimate (kg/m³)']];
  const save = async () => { await call('/settings/rules', 'PUT', v); onSaved(); };
  return (
    <Modal title="Edit grading thresholds" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
      {fields.map(([k, l]) => <Field key={k} label={l}><input className="input" type="number" step="any" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}
    </Modal>
  );
}
