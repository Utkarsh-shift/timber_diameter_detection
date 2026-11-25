import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post, useApi } from '../api.js';
import DateRange, { rangeQuery } from '../components/DateRange.jsx';
import { Badge, Card, Icon, Loading, Modal, PageHead, fmt, STAGE_LABEL, STAGE_TONE, useToast } from '../ui.jsx';

// every log of one truck, with CSV / Excel download
function TruckLogs({ truck, onClose }) {
  const { data } = useApi(`/trucks/${truck.id}/logs`);
  const [q, setQ] = useState('');
  const logs = (data?.logs || []).filter((l) => !q || l.label.toLowerCase().includes(q.toLowerCase()));
  const a = data?.aggregates;
  return (
    <Modal wide title={`${truck.id} • ${truck.plate}`} onClose={onClose}
      footer={<><a className="btn" href={`/api/reports/${truck.id}/csv`}><Icon n="download" />Export CSV</a><a className="btn btn-primary" href={`/api/reports/${truck.id}/xlsx`}><Icon n="table" />Export Excel</a></>}>
      {!data ? <Loading /> : <>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mono text-[11px] text-[#414845]">
          <span>{fmt(a.total)} logs</span><span>mean {a.mean} mm</span><span>median {a.median} mm</span><span>±{a.std}</span><span>min {a.min} • max {a.max}</span>
          <span className="flex-1" /><input className="input !h-8 w-40" placeholder="Search log id" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="overflow-auto border border-[#e2e8e2] rounded" style={{ maxHeight: '55vh' }}>
          <table className="dt"><thead className="sticky top-0 bg-white"><tr><th>Log</th><th>Diameter</th><th>Major</th><th>Minor</th><th>Ovality</th><th>Area (cm²)</th><th>Conf</th><th>Status</th></tr></thead>
            <tbody>{logs.map((l) => <tr key={l.id}><td className="mono font-semibold">{l.label}</td><td className="mono">{l.eq_dia}</td><td className="mono">{l.major}</td><td className="mono">{l.minor}</td><td className="mono">{l.minor ? (l.major / l.minor).toFixed(3) : '–'}</td><td className="mono">{l.area}</td><td className="mono">{l.conf}%</td><td><Badge tone={l.status === 'VALID' ? 'ok' : l.status === 'REJECTED' ? 'bad' : 'warn'}>{l.status}</Badge></td></tr>)}
              {!logs.length && <tr><td colSpan="8" className="text-center text-[#718078] py-6">No logs{q ? ' match this search' : ''}</td></tr>}</tbody></table>
        </div>
      </>}
    </Modal>
  );
}

const TILES = [['', 'All trucks'], ['ai_inference', 'AI inference'], ['verification', 'Verification'], ['completed', 'Completed'], ['flagged', 'Flagged']];

// every truck of the company: the ones still in the queue and the finished ones
export function History() {
  const nav = useNavigate(); const toast = useToast();
  const [sp] = useSearchParams();
  const [range, setRange] = useState(null); // null = all time
  const [filter, setFilter] = useState(sp.get('filter') || ''); const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null); // truck whose logs are shown
  const qs = [`page=${page}`, 'size=15', q && 'q=' + encodeURIComponent(q), filter === 'flagged' ? 'status=flagged' : filter && 'stage=' + filter, range && rangeQuery(range)].filter(Boolean).join('&');
  const { data: d, reload } = useApi('/history?' + qs, { live: ['truck'] });
  const reset = (fn) => (v) => { fn(v); setPage(1); };
  const advance = async (id) => { await post(`/trucks/${id}/advance`); toast(`${id} advanced to the next stage`); reload(); };
  const flag = async (id) => { await post(`/trucks/${id}/flag`, { reason: 'Flagged for review' }); toast(`${id} flagged for review`, 'bad'); reload(); };
  const csv = '/api/history/csv?' + qs.replace(/page=\d+&size=15&?/, '');

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Measurement History">
        <input className="input w-44" placeholder="Search truck or plate" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        <DateRange value={range} onChange={reset(setRange)} />
        <a className="btn" href={csv}><Icon n="download" />Export CSV</a>
      </PageHead>
      {!d ? <Loading /> : <>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {TILES.map(([k, l]) => (
            <button key={k} onClick={() => reset(setFilter)(filter === k ? '' : k)} className={`card p-3 text-left ${filter === k ? 'ring-1 ring-[#173f35] bg-[#e7f7ee]' : ''}`}>
              <div className="lbl">{l}</div><div className="text-[24px] font-semibold mono">{fmt(d.counts[k === '' ? 'all' : k] || 0)}</div>
            </button>))}
        </div>
        <Card>
          <div className="overflow-x-auto"><table className="dt"><thead><tr><th>Truck / Plate</th><th>Date</th><th>Time</th><th>Logs</th><th>Mean Ø</th><th>Std</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{d.items.map((t) => {
              const bad = t.flagged === 1;
              return (
                <tr key={t.id} className={`cursor-pointer hover:bg-[#e7f7ee] ${bad ? 'bg-[#c94c4c0a]' : ''}`} title="Show the logs of this truck" onClick={() => setOpen(t)}>
                  <td><div className={`mono font-semibold ${bad ? 'text-[#c94c4c]' : ''}`}>{t.id}</div><div className="mono text-[10px] text-[#718078]">{t.plate}</div></td>
                  <td className="mono">{new Date(t.arrived_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td><td className="mono">{t.time}</td>
                  <td className="mono">{t.logs_detected}</td><td className="mono">{t.logs_detected ? `${t.avg_dia} mm` : '–'}</td><td className="mono">{t.logs_detected ? `±${t.std_dia}` : '–'}</td>
                  <td>{bad ? <Badge tone="bad">Flagged{t.flag_reason ? ` · ${t.flag_reason}` : ''}</Badge> : <Badge tone={STAGE_TONE[t.stage]}>{t.stage === 'completed' ? 'Approved' : STAGE_LABEL[t.stage]}</Badge>}</td>
                  <td onClick={(e) => e.stopPropagation()}><div className="flex gap-1">
                    {t.stage !== 'completed' && <button className="btn" title="Advance to the next stage" onClick={() => advance(t.id)}><Icon n="skip_next" /></button>}
                    {t.logs_detected > 0 && <button className="btn" onClick={() => nav('/studio?truck=' + t.id)}>Studio</button>}
                    {t.stage === 'completed' && <button className="btn btn-primary" onClick={() => nav('/reports/' + t.id)}>Report</button>}
                    {t.stage !== 'completed' && !bad && <button className="btn btn-danger" title="Flag for review" onClick={() => flag(t.id)}><Icon n="flag" /></button>}
                  </div></td>
                </tr>);
            })}
              {!d.items.length && <tr><td colSpan="8" className="text-center text-[#718078] py-8">No trucks match the current filters.</td></tr>}
            </tbody></table></div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e8e2]">
            <span className="lbl">{fmt(d.total)} truck{d.total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-2"><button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button><span className="mono text-[11px]">{page} / {d.pages}</span><button className="btn" disabled={page >= d.pages} onClick={() => setPage(page + 1)}>Next</button></div>
          </div>
        </Card>
      </>}
      {open && <TruckLogs truck={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function Stub({ title, icon }) {
  return <div className="flex flex-col items-center justify-center py-24 gap-3 text-center"><Icon n={icon} style={{ fontSize: 48 }} className="text-[#718078]" /><h1 className="text-[22px] font-semibold">{title}</h1><p className="text-[13px] text-[#718078] max-w-md">This module is outside the demo scope. The overview, intake, measurement studio, quality, model and certificate screens are live.</p><Link to="/" className="btn btn-primary">Back to Overview</Link></div>;
}
