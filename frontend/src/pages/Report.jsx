import { useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../api.js';
import { Badge, Bars, Card, Icon, Loading, PageHead, Section, fmt } from '../ui.jsx';

export default function Report() {
  const { truckId } = useParams(); const nav = useNavigate();
  const { data: list } = useApi('/reports');
  const id = truckId || list?.[0]?.id;
  const { data: r } = useApi(id ? '/reports/' + id : '/health');
  if (!id || !r?.truck) return <Loading />;
  const t = r.truck, s = r.stats, c = r.cert, an = r.analysis;
  const mode = r.hist.reduce((m, h) => (h.count > m.count ? h : m), r.hist[0]);
  const stamp = c ? new Date(c.issued_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : null;

  return (
    <div className="flex flex-col gap-4 max-w-[1100px] mx-auto">
      <PageHead title={`Report · ${t.id}`}>
        <button className="btn" onClick={() => nav('/reports')}><Icon n="arrow_back" />All Reports</button>
        <select className="input" value={id} onChange={(e) => nav('/reports/' + e.target.value)}>{list?.map((x) => <option key={x.id}>{x.id}</option>)}</select>
        <a className="btn" href={`/api/reports/${id}/csv`}><Icon n="table" />Export CSV</a>
        <button className="btn btn-primary" onClick={() => window.print()}><Icon n="print" />Print / PDF</button>
      </PageHead>
      <div className="flex items-center gap-3 -mt-2">{c ? <Badge tone="ok">APPROVED</Badge> : <Badge tone="warn">NOT YET COMMITTED</Badge>}{c && <span className="mono text-[11px] text-[#718078]">{c.uuid} · {stamp}</span>}</div>

      <Card>
        <div className="grid md:grid-cols-2 gap-0 divide-x divide-[#e2e8e2]">
          <Block title="Transport" rows={[['Plate', t.plate], ['Driver', t.driver], ['Haulier', t.hauler]]} />
          <Block title="Timber" rows={[['Species', t.species], ...(an ? [['Grade', an.grade.grade], ['Action', an.grade.action]] : [])]} />
        </div>
        <div className="mono text-[10px] text-[#414845] bg-[#f5f7f5] px-4 py-2 border-t border-[#e2e8e2]">
          {t.scale_mm_px ? `Scale ${t.scale_mm_px} mm/px (${t.scale_src})` : 'Seeded demo data'}{t.engine ? ` • ${t.engine}` : ''}{t.infer_ms ? ` • ${Math.round(t.infer_ms)} ms` : ''}{an ? ` • image ${t.img_w}×${t.img_h}px` : ''}
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['Logs', s.count, ''], ['Mean Ø', s.mean, 'mm'], ['Median Ø', s.median, `±${s.std} mm`], ['Max Ø', s.max, `min ${s.min} mm`]].map(([l, v, u]) => <Card key={l} className="p-3"><div className="lbl">{l}</div><div className="mono text-[22px] font-semibold">{v}</div><div className="mono text-[10px] text-[#718078]">{u}</div></Card>)}
      </div>

      <Section title="Photo">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="relative rounded overflow-hidden"><img src={t.image || '/img/reports_verification_certificate-3.jpg'} className="w-full h-64 object-cover" alt="original" /><span className="absolute top-2 left-2 mono text-[10px] bg-[#173f35] text-white px-1.5 py-0.5">ORIGINAL</span></div>
          <div className="relative rounded overflow-hidden"><img src={t.annotated || '/img/reports_verification_certificate-4.jpg'} className="w-full h-64 object-cover" alt="detections" /><span className="absolute top-2 left-2 mono text-[10px] bg-[#173f35] text-white px-1.5 py-0.5">DETECTIONS</span>{an && <span className="absolute top-2 right-2 mono text-[10px] bg-[#a4c66c] text-[#173f35] px-1.5 py-0.5">{s.count} logs · conf {an.summary.mean_conf}%</span>}</div>
        </div>
      </Section>

      <div className="grid md:grid-cols-3 gap-4">
        <Section className="md:col-span-2" title="Diameter Distribution" right={<Badge tone="ok">{s.in_tolerance}% within 100–150 mm</Badge>}>
          <Bars data={r.hist.map((h) => ({ l: `${h.from}-${h.to}`, v: h.count }))} height={170} hi={r.hist.indexOf(mode)} />
          <div className="grid grid-cols-3 gap-2 mt-3 bg-[#f5f7f5] rounded p-2 mono text-[11px]"><span>Q1: {s.q1} mm</span><span>Median: {s.median} mm</span><span>Q3: {s.q3} mm</span></div>
        </Section>
        <Section title="Quality" right={an ? <Badge tone={an.grade.tone}>GRADE {an.grade.grade}</Badge> : null}>
          {[['Roundness', r.quality.circularity, '%'], ['Crack length (avg % of Ø)', an && !r.quality.measured ? 'n/a' : r.quality.cracks, an && !r.quality.measured ? '' : '%'], ['Bark-free end face', r.quality.bark, '%'], ['Flagged logs', r.quality.noncompliant, '']].map(([l, v, u]) => <div key={l} className="mb-3"><div className="flex justify-between text-[12px]"><span>{l}</span><span className="mono">{v}{u}</span></div><div className="h-1 bg-[#e2e8e2] rounded"><div className="h-1 bg-[#173f35] rounded" style={{ width: Math.min(100, typeof v !== 'number' ? 0 : u === '%' ? v : v * 5) + '%' }} /></div></div>)}
          {an && <div className="mono text-[11px] text-[#414845]">A {an.grade.pct.A.toFixed(0)}% · B {an.grade.pct.B.toFixed(0)}% · C {an.grade.pct.C.toFixed(0)}% · reject {an.grade.pct.R.toFixed(0)}%</div>}
        </Section>
      </div>
    </div>
  );
}
const Block = ({ title, rows }) => <div className="p-4"><div className="lbl mb-2">{title}</div>{rows.map(([k, v]) => <div key={k} className="flex justify-between text-[12px] py-0.5 gap-2"><span className="text-[#718078]">{k}</span><span className="mono text-right">{v}</span></div>)}</div>;
