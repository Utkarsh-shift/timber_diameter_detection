import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api.js';
import DateRange, { rangeQuery } from '../components/DateRange.jsx';
import { Badge, Card, Icon, Loading, PageHead, fmt } from '../ui.jsx';

const SIZE = 12;

// every issued report of the signed-in company
export default function Reports() {
  const nav = useNavigate();
  const [range, setRange] = useState(null); const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const qs = [`page=${page}`, `size=${SIZE}`, q && 'q=' + encodeURIComponent(q), range && rangeQuery(range)].filter(Boolean).join('&');
  const { data: d } = useApi('/report-list?' + qs, { live: ['truck'] });
  const reset = (fn) => (v) => { fn(v); setPage(1); };
  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Reports">
        <input className="input w-44" placeholder="Search truck or plate" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        <DateRange value={range} onChange={reset(setRange)} />
      </PageHead>
      {!d ? <Loading /> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="dt"><thead><tr><th>Truck / Plate</th><th>Date</th><th>Time</th><th>Logs</th><th>Mean Ø</th><th>Std</th><th>Status</th><th>Issued</th><th /></tr></thead>
              <tbody>{d.items.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-[#e7f7ee]" onClick={() => nav('/reports/' + t.id)}>
                  <td><div className="mono font-semibold">{t.id}</div><div className="mono text-[10px] text-[#718078]">{t.plate}</div></td>
                  <td className="mono">{new Date(t.arrived_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td className="mono">{t.time}</td><td className="mono">{fmt(t.logs_detected)}</td><td className="mono">{t.avg_dia} mm</td><td className="mono">±{t.std_dia}</td>
                  <td>{t.flagged ? <Badge tone="bad">Flagged</Badge> : <Badge tone="ok">Approved</Badge>}</td>
                  <td className="mono text-[11px] text-[#718078]">{new Date(t.issued_at).toISOString().replace('T', ' ').slice(0, 16)}</td>
                  <td onClick={(e) => e.stopPropagation()}><div className="flex gap-1"><button className="btn btn-primary" onClick={() => nav('/reports/' + t.id)}>Open</button><a className="btn" href={`/api/reports/${t.id}/csv`} title="Download CSV"><Icon n="download" /></a></div></td>
                </tr>))}
                {!d.items.length && <tr><td colSpan="9" className="text-center text-[#718078] py-8">No reports {range || q ? 'match these filters' : 'yet — approve a truck in the Studio to issue one'}</td></tr>}
              </tbody></table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e8e2]">
            <span className="lbl">{d.total} report{d.total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-2"><button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button><span className="mono text-[11px]">{page} / {d.pages}</span><button className="btn" disabled={page >= d.pages} onClick={() => setPage(page + 1)}>Next</button></div>
          </div>
        </Card>
      )}
    </div>
  );
}
