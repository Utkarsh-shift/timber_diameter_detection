import { createContext, useCallback, useContext, useState } from 'react';

export const Icon = ({ n, className = '', style }) => <span className={`material-symbols-outlined ${className}`} style={style}>{n}</span>;

const TONES = {
  ok: 'bg-[#a4c66c26] text-[#245b49] border-[#a4c66c66]', warn: 'bg-[#d69b3220] text-[#8a5f14] border-[#d69b3260]',
  bad: 'bg-[#c94c4c18] text-[#8a1e1e] border-[#c94c4c50]', info: 'bg-[#2b6cb015] text-[#1d4f85] border-[#2b6cb040]', mute: 'bg-[#f5f7f5] text-[#17241f] border-[#e2e8e2]', dark: 'bg-[#173f35] text-white border-[#173f35]',
};
export const Badge = ({ tone = 'mute', dot, children, className = '' }) => (
  <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 border rounded-[3px] mono text-[10px] uppercase tracking-wide whitespace-nowrap ${TONES[tone]} ${className}`}>
    {dot && <span className={`w-1.5 h-1.5 rounded-full ${tone === 'ok' ? 'bg-[#a4c66c] pulse-dot' : tone === 'bad' ? 'bg-[#c94c4c]' : tone === 'warn' ? 'bg-[#d69b32]' : 'bg-[#718078]'}`} />}{children}
  </span>
);

export const Card = ({ className = '', children, ...p }) => <div className={`card ${className}`} {...p}>{children}</div>;
export const Section = ({ title, sub, right, children, className = '' }) => (
  <Card className={`p-4 ${className}`}>
    <div className="flex items-start justify-between gap-3 mb-3">
      <div><h3 className="text-[13px] font-semibold uppercase tracking-wide flex items-center gap-2"><span className="w-1.5 h-1.5 bg-[#173f35] inline-block" />{title}</h3></div>
      {right}
    </div>{children}
  </Card>
);
export const Kpi = ({ label, value, unit, icon, sub, foot, tone, bar }) => (
  <Card className="p-3 flex flex-col gap-1">
    <div className="flex justify-between items-start"><span className="lbl">{label}</span>{icon && <Icon n={icon} className="text-[#718078]" />}</div>
    <div className="flex items-baseline gap-1.5"><span className="text-[26px] leading-8 font-semibold tracking-tight">{value}</span>{unit && <span className="mono text-[12px] text-[#718078]">{unit}</span>}</div>
    {bar != null && <div className="h-1 bg-[#e2e8e2] rounded"><div className="h-1 bg-[#173f35] rounded" style={{ width: Math.min(100, bar) + '%' }} /></div>}
    {sub && <div className="mono text-[11px] text-[#718078]">{sub}</div>}
    {foot && <Badge tone={tone || 'ok'} className="self-start mt-1">{foot}</Badge>}
  </Card>
);
export const PageHead = ({ tag, title, desc, children }) => (
  <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
    <div className="max-w-3xl">
      <h1 className="text-[24px] leading-8 font-semibold tracking-tight">{title}</h1>
    </div>
    <div className="flex flex-wrap gap-2 no-print">{children}</div>
  </div>
);
export const Loading = () => <div className="p-10 text-center mono text-[12px] text-[#718078]">Loading telemetry…</div>;

export const Progress = ({ value, tone = 'ok' }) => <div className="h-1 bg-[#e2e8e2] rounded"><div className={`h-1 rounded ${tone === 'bad' ? 'bg-[#c94c4c]' : 'bg-[#173f35]'}`} style={{ width: value + '%' }} /></div>;

export function Donut({ parts, size = 160, label, sub }) {
  const total = parts.reduce((s, p) => s + p.v, 0) || 1; const R = 60, C = 2 * Math.PI * R; let off = 0;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 160 160" width={size} height={size} className="-rotate-90">
        <circle cx="80" cy="80" r={R} fill="none" stroke="#e2e8e2" strokeWidth="14" />
        {parts.map((p, i) => { const len = (p.v / total) * C; const el = <circle key={i} cx="80" cy="80" r={R} fill="none" stroke={p.c} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />; off += len; return el; })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[26px] font-semibold">{label}</span><span className="mono text-[10px] text-[#718078]">{sub}</span></div>
    </div>
  );
}

export function Bars({ data, height = 120, color = '#173f35', hi, labels = true, red }) {
  const max = Math.max(1, ...data.map((d) => d.v));
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${d.l}: ${d.v}`}>
          <div className="w-full rounded-sm" style={{ height: Math.max(2, (d.v / max) * (height - 18)), background: red && red(d, i) ? '#c94c4c' : hi === i ? '#245b49' : color, opacity: hi == null || hi === i ? 1 : 0.8 }} />
          {labels && <span className="mono text-[9px] text-[#718078]">{d.l}</span>}
        </div>
      ))}
    </div>
  );
}

export function Line({ series, height = 120, color = '#173f35', fill = true, yMin, yMax }) {
  const W = 400, H = height; const flat = series.flat(); const lo = yMin ?? Math.min(...flat), hi = yMax ?? Math.max(...flat);
  const px = (i, n) => (i / Math.max(1, n - 1)) * W, py = (v) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H}>
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="#e2e8e2" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
      {series.map((s, k) => {
        const d = s.map((v, i) => `${i ? 'L' : 'M'}${px(i, s.length).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
        return <g key={k}>{fill && k === 0 && <path d={`${d} L${W},${H} L0,${H} Z`} fill={color} opacity="0.08" />}<path d={d} fill="none" stroke={k === 0 ? color : '#a4c66c'} strokeWidth="1.8" strokeDasharray={k > 0 ? '4 3' : undefined} vectorEffect="non-scaling-stroke" /></g>;
      })}
    </svg>
  );
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, tone = 'ok') => { const id = Math.random(); setItems((x) => [...x, { id, msg, tone }]); setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500); }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 no-print">
        {items.map((t) => <div key={t.id} className={`px-3 py-2 rounded border shadow-lg text-[12px] bg-white flex items-center gap-2 ${t.tone === 'bad' ? 'border-[#c94c4c]' : 'border-[#173f35]'}`}><Icon n={t.tone === 'bad' ? 'error' : 'check_circle'} className={t.tone === 'bad' ? 'text-[#c94c4c]' : 'text-[#245b49]'} />{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17241f66] backdrop-blur-[2px] no-print" onClick={onClose}>
      <div className={`bg-white border border-[#17241f] rounded-lg shadow-2xl ${wide ? 'w-[900px]' : 'w-[480px]'} max-w-[92vw]`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-[#e2e8e2]"><h3 className="text-[14px] font-semibold">{title}</h3><button onClick={onClose}><Icon n="close" /></button></div>
        <div className="p-4 flex flex-col gap-3">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-[#e2e8e2] flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
export const Field = ({ label, children }) => <label className="flex flex-col gap-1"><span className="lbl">{label}</span>{children}</label>;

export const fmt = (n, d = 0) => (n == null ? '–' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const STAGE_LABEL = { ai_inference: 'AI Inference', verification: 'Verification', completed: 'Completed' };
export const STAGE_TONE = { ai_inference: 'info', verification: 'warn', completed: 'ok' };

// Shows a zoomed window of `src` centred on a log (x, y, rx are percentages of the image width / height / width).
export function Crop({ src, log, imgW = 512, imgH = 279, className = '', children }) {
  if (!log) return <div className={className}>{children}</div>;
  const rx = log.rx ?? log.r ?? 3;
  const w = Math.min(100, Math.max(8, rx * 7)); // window width, % of image width
  const hh = Math.min(100, w * (imgW / imgH)); // window height, % of image height (square window)
  const px = w >= 100 ? 0 : Math.min(100, Math.max(0, ((log.x - w / 2) / (100 - w)) * 100));
  const py = hh >= 100 ? 0 : Math.min(100, Math.max(0, ((log.y - hh / 2) / (100 - hh)) * 100));
  return <div className={className} style={{ backgroundImage: `url(${src})`, backgroundSize: `${10000 / w}% auto`, backgroundPosition: `${px}% ${py}%`, backgroundRepeat: 'no-repeat' }}>{children}</div>;
}

export function Spark({ data, height = 40, color = '#245b49' }) {
  if (!data || data.length < 2) return <div className="mono text-[10px] text-[#718078]" style={{ height }}>not enough data yet</div>;
  const W = 200, lo = Math.min(...data), hi = Math.max(...data);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * W, height - 4 - ((v - lo) / (hi - lo || 1)) * (height - 8)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
      <path d={`${d} L${W},${height} L0,${height} Z`} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  );
}
