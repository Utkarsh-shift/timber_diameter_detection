import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useApi } from '../api.js';
import DateRange, { rangeQuery } from '../components/DateRange.jsx';
import { Badge, Card, Donut, Icon, Loading, PageHead, Section, Spark, fmt, STAGE_LABEL, STAGE_TONE, useToast } from '../ui.jsx';

export default function Overview() {
  const [range, setRange] = useState(null); // null = all time
  const { data: d } = useApi('/overview' + (range ? '?' + rangeQuery(range) : ''), { live: ['tick', 'truck'] });
  const nav = useNavigate(); const toast = useToast();
  if (!d) return <Loading />;
  const k = d.kpis; const maxBand = Math.max(...d.bands.map((b) => b.count));
  const st = d.stages; const total = d.total_trucks;
  const parts = [
    { l: 'Completed', v: st.completed || 0, c: '#173f35' }, { l: 'In inference', v: st.ai_inference || 0, c: '#a4c66c' },
    { l: 'Verification', v: st.verification || 0, c: '#245b49' }, { l: 'Flagged', v: st.flagged || 0, c: '#c94c4c' },
  ];
  const exportSummary = () => { const blob = new Blob([JSON.stringify(d.kpis, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'summary.json'; a.click(); toast('Summary exported'); };

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Overview">
        <DateRange value={range} onChange={setRange} />
        <button className="btn" onClick={exportSummary}><Icon n="download" />Export</button>
      </PageHead>

      <div className="grid lg:grid-cols-3 gap-3">
        <Card className="p-4 lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><div className="lbl">Log diameter</div><div className="flex items-baseline gap-2"><span className="text-[34px] leading-10 font-semibold tracking-tight">{fmt(k.avg_dia, 1)}</span><span className="mono text-[12px] text-[#718078]">mm average</span></div></div>
            <div className="flex gap-5 mono text-[11px] text-[#414845]"><div><div className="lbl">Median</div><b className="text-[15px]">{fmt(k.median_dia, 1)}</b></div><div><div className="lbl">Std dev</div><b className="text-[15px]">±{k.std_dia}</b></div><div><div className="lbl">P90</div><b className="text-[15px]">{k.p90}</b></div><div><div className="lbl">Logs</div><b className="text-[15px]">{fmt(k.blocks)}</b></div></div>
          </div>
          <div className="relative mt-4" style={{ height: 120 }}>
            <div className="absolute inset-0 flex items-end gap-1">{d.hist.map((h, i) => { const mx = Math.max(1, ...d.hist.map((x) => x.count)); return <div key={i} className="flex-1 rounded-t-sm" title={`${h.from}-${h.to}: ${h.count}`} style={{ height: Math.max(2, (h.count / mx) * 100) + '%', background: h.to <= 90 ? '#c94c4c99' : h.from >= 100 && h.to <= 150 ? '#245b49' : '#a4c66c' }} />; })}</div>
            {[['avg', k.avg_dia, '#173f35'], ['median', k.median_dia, '#2b6cb0'], ['P90', k.p90, '#d69b32']].map(([l, v, c]) => { const x = Math.min(100, Math.max(0, ((v - 70) / 100) * 100)); return <div key={l} className="absolute top-0 bottom-0 border-l border-dashed" style={{ left: x + '%', borderColor: c }}><span className={`absolute -top-0.5 ${l === 'avg' ? 'right-1' : 'left-1'} mono text-[9px] px-1 rounded-sm bg-white border`} style={{ color: c, borderColor: c }}>{l}</span></div>; })}
          </div>
          <div className="flex justify-between mono text-[9px] text-[#718078] mt-1">{[70, 90, 110, 130, 150, 170].map((x) => <span key={x}>{x}</span>)}</div>
        </Card>

        <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
          <Card className="p-4">
            <div className="flex items-baseline justify-between"><span className="lbl">Trucks</span><span className="text-[26px] font-semibold leading-8">{k.trucks}</span></div>
            <div className="flex h-2.5 rounded overflow-hidden mt-3 bg-[#e2e8e2]">{parts.map((p) => <div key={p.l} title={`${p.l}: ${p.v}`} style={{ width: (p.v / Math.max(1, total)) * 100 + '%', background: p.c }} />)}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">{parts.filter((p) => p.v > 0).map((p) => <span key={p.l} className="mono text-[10px] text-[#414845] flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: p.c }} />{p.l} {p.v}</span>)}</div>
          </Card>
          <Card className="p-4 flex items-center gap-4">
            <Donut size={84} parts={[{ v: k.flagged, c: '#c94c4c' }, { v: Math.max(0, total - k.flagged), c: '#d6e6dd' }]} label={Math.round((k.flagged / Math.max(1, total)) * 100) + '%'} sub="" />
            <div><div className="lbl">Flagged</div><div className="text-[26px] font-semibold leading-8">{k.flagged}</div><div className="mono text-[10px] text-[#718078]">of {total} trucks</div></div>
          </Card>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-baseline justify-between"><span className="lbl">Logs detected</span><span className="mono text-[11px] text-[#718078]">per truck, last {d.spark.length}</span></div>
          <div className="text-[26px] font-semibold leading-8">{fmt(k.blocks)}</div>
          <div className="mt-2"><Spark data={d.spark} height={44} /></div>
        </Card>
        <Card className="p-4">
          <div className="flex items-baseline justify-between"><span className="lbl">In queue</span><span className="text-[26px] font-semibold leading-8">{k.queue}</span></div>
          <div className="flex items-end gap-1.5 mt-3" style={{ height: 44 }}>{[['ai_inference', 'AI'], ['verification', 'Review']].map(([key, label]) => { const n = st[key] || 0; const mx = Math.max(1, st.ai_inference || 0, st.verification || 0); return <div key={key} className="flex-1 flex flex-col items-center justify-end h-full gap-1"><div className="w-full rounded-sm bg-[#245b49]" style={{ height: Math.max(3, (n / mx) * 100) + '%', opacity: n ? 1 : 0.25 }} title={`${label}: ${n}`} /></div>; })}</div>
          <div className="flex gap-1.5 mt-1">{['AI', 'Review'].map((l, i) => <span key={l} className="flex-1 text-center mono text-[9px] text-[#718078]">{l}<br /><b className="text-[#17241f]">{st[['ai_inference', 'verification'][i]] || 0}</b></span>)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-baseline justify-between"><span className="lbl">Analysis time</span><span className="text-[26px] font-semibold leading-8">{k.avg_process}</span></div>
          <div className="mt-2"><Spark data={d.ms_series} height={44} color="#2b6cb0" /></div>
          <div className="mono text-[10px] text-[#718078] mt-1">{k.process_sub}</div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center gap-4 px-4 pt-3"><h3 className="text-[13px] font-semibold flex items-center gap-2"><Icon n="table_rows" />Recent Arrivals</h3><div className="flex-1" /><Link to="/history" className="btn">Open Truck History</Link></div>
        <div className="overflow-x-auto mt-2"><table className="dt"><thead><tr><th>Truck / Plate</th><th>Time</th><th>Logs</th><th>Avg Ø</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{d.recent.map((t) => {
            const bad = t.flagged === 1; const done = t.stage === 'completed';
            return <tr key={t.id} className={bad ? 'bg-[#c94c4c0a]' : ''}>
              <td><div className={`mono font-semibold ${bad ? 'text-[#c94c4c]' : ''}`}>{t.id}</div><div className="mono text-[10px] text-[#718078]">{t.plate}</div></td>
              <td className="mono">{t.time}</td><td className="mono">{t.logs_detected}</td>
              <td className="mono"><span className={bad ? 'text-[#c94c4c]' : ''}>{t.logs_detected ? `${t.avg_dia} mm` : '–'}</span></td>
              <td>{bad ? <Badge tone="bad">Flagged · {t.flag_reason}</Badge> : <Badge tone={STAGE_TONE[t.stage]}>{done ? 'Approved' : STAGE_LABEL[t.stage]}</Badge>}</td>
              <td><div className="flex gap-1.5"><button className={`btn ${bad ? 'btn-primary' : ''}`} onClick={() => nav('/studio?truck=' + t.id)}>{bad ? 'Review' : 'Studio'}</button>{done && <button className="btn btn-primary" onClick={() => nav('/reports/' + t.id)}>Report</button>}</div></td></tr>;
          })}</tbody></table></div>
      </Card>
    </div>
  );
}
