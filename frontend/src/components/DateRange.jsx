import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui.jsx';

const DAY = 86400000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const same = (a, b) => a && b && a.getTime() === b.getTime();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const short = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// value: { from: Date, to: Date } (inclusive days) or null for all time
export const rangeQuery = (v) => (v ? `from=${encodeURIComponent(v.from.toISOString())}&to=${encodeURIComponent(addDays(v.to, 1).toISOString())}` : '');

export default function DateRange({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfDay(value?.from || new Date()));
  const [pick, setPick] = useState(null); // first click of a new range
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const today = startOfDay(new Date());

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setPick(null); } };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const label = !value ? 'All time' : same(value.from, today) && same(value.to, today) ? 'Today' : same(value.from, value.to) ? short(value.from) : `${short(value.from)} – ${short(value.to)}`;
  const set = (v) => { onChange(v); setPick(null); setOpen(false); };

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i - lead));
  const preview = pick ? (hover && hover < pick ? { from: hover, to: pick } : { from: pick, to: hover || pick }) : value;
  const click = (d) => {
    if (!pick) { setPick(d); return; }
    set(d < pick ? { from: d, to: pick } : { from: pick, to: d });
  };
  const presets = [
    ['Today', { from: today, to: today }], ['Yesterday', { from: addDays(today, -1), to: addDays(today, -1) }],
    ['Last 7 days', { from: addDays(today, -6), to: today }], ['Last 30 days', { from: addDays(today, -29), to: today }], ['All time', null],
  ];

  return (
    <div className="relative" ref={box}>
      <button className="btn" onClick={() => setOpen(!open)}><Icon n="calendar_month" />{label}<Icon n="expand_more" /></button>
      {open && (
        <div className="absolute right-0 mt-1 z-40 bg-white border border-[#e2e8e2] rounded shadow-lg flex" style={{ width: 400 }}>
          <div className="flex flex-col gap-0.5 p-2 border-r border-[#e2e8e2] w-[120px] shrink-0">
            {presets.map(([l, v]) => <button key={l} className="text-left text-[12px] px-2 py-1.5 rounded hover:bg-[#e7f7ee]" onClick={() => set(v)}>{l}</button>)}
          </div>
          <div className="p-3 flex-1">
            <div className="flex items-center justify-between mb-2">
              <button className="btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><Icon n="chevron_left" /></button>
              <b className="text-[12.5px]">{MONTHS[month.getMonth()]} {month.getFullYear()}</b>
              <button className="btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><Icon n="chevron_right" /></button>
            </div>
            <div className="grid grid-cols-7 text-center mono text-[10px] text-[#718078] mb-1">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, i) => <span key={i}>{x}</span>)}</div>
            <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(null)}>
              {cells.map((d) => {
                const inMonth = d.getMonth() === month.getMonth();
                const inR = preview && d >= preview.from && d <= preview.to;
                const edge = preview && (same(d, preview.from) || same(d, preview.to));
                return (
                  <button key={d.getTime()} disabled={d > today} onClick={() => click(d)} onMouseEnter={() => setHover(d)}
                    className={`h-8 text-[12px] ${edge ? 'bg-[#173f35] text-white rounded' : inR ? 'bg-[#a4c66c55]' : 'hover:bg-[#e7f7ee] rounded'} ${inMonth ? '' : 'opacity-40'} ${d > today ? 'opacity-20 cursor-not-allowed' : ''} ${same(d, today) && !edge ? 'font-bold underline' : ''}`}>
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="mono text-[10px] text-[#718078] mt-2">{pick ? 'Now pick the end date' : 'Pick a start date, then an end date'}</div>
          </div>
        </div>
      )}
    </div>
  );
}
