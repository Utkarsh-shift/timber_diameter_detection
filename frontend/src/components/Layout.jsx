import { createContext, useContext, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Icon, Badge, Modal, useToast } from '../ui.jsx';
import { useApi, useStream } from '../api.js';

const NAV = [
  ['', [['/', 'Overview', 'dashboard'], ['/studio', 'AI Measurement Studio', 'center_focus_strong', 'live'], ['/history', 'Measurement History', 'history', 'q'], ['/quality', 'Quality Assessment', 'fact_check'], ['/reports', 'Reports', 'description'], ['/models', 'AI Model Monitoring', 'monitoring']]],
];

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" width="30" height="30"><rect width="32" height="32" rx="6" fill="#173f35" /><path d="M16 5l7 9h-4l5 7h-6v6h-4v-6H8l5-7H9z" fill="#a4c66c" /></svg>
      <div className="leading-tight"><div className="flex items-center gap-1.5"><span className="text-[16px] font-bold tracking-tight">PINE OS</span></div><div className="mono text-[8px] text-[#718078] tracking-wider">INDUSTRIAL WOOD INTELLIGENCE</div></div>
    </div>
  );
}

export default function Layout({ children, user, onSignOut }) {
  const { data: trucks, reload } = useApi('/trucks?size=1');
  const [lat, setLat] = useState(14);
  const [ask, setAsk] = useState(false);
  const { data: health, reload: reloadHealth } = useApi('/analysis/health');
  const [conn, setConn] = useState(true);
  useStream((t, e) => { if (t === 'tick') { reloadHealth(); try { setLat(JSON.parse(e.data).lat); } catch {} reload(); } if (t === 'open') setConn(true); if (t === 'error') setConn(false); if (t === 'truck') reload(); });
  const badge = { q: trucks?.in_yard };

  return (
    <div className="min-h-screen flex">
      <aside className="fixed inset-y-0 left-0 w-[220px] bg-[#e7f7ee] border-r border-[#e2e8e2] flex flex-col z-30 overflow-y-auto no-print">
        <div className="p-3"><Logo /></div>
        <nav className="flex-1 px-2 pb-3">
          {NAV.map(([h, items]) => (
            <div key={h} className="mt-3">
              {items.map(([to, label, icon, tag]) => (
                <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex items-center gap-2 px-2 py-1.5 rounded text-[12.5px] ${isActive ? 'bg-[#173f35] text-white font-medium' : 'text-[#17241f] hover:bg-[#d6e6dd]'}`}>
                  <Icon n={icon} /><span className="flex-1 truncate">{label}</span>
                  {tag === 'live' && <span className="mono text-[9px] bg-[#a4c66c] text-[#173f35] px-1 rounded-sm">LIVE CV</span>}
                  {tag && tag !== 'live' && badge[tag] > 0 && <span className="mono text-[10px] px-1 rounded-sm bg-[#a4c66c40] text-[#245b49]">{badge[tag]}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="p-2 flex flex-col gap-2">
        </div>
      </aside>

      <div className="flex-1 ml-[220px] min-w-0">
        <header className="topbar sticky top-0 z-20 bg-[#f5f7f5]/95 backdrop-blur border-b border-[#e2e8e2] px-4 h-12 flex items-center gap-3">
          <Badge tone={health?.up ? 'ok' : 'bad'} dot>{health?.up ? `CV Engine online · OpenCV ${health.opencv}` : 'CV Engine offline'}</Badge>
          <div className="flex-1" />
          <div className="text-right leading-tight"><div className="text-[12.5px] font-semibold">{user.company}</div><div className="mono text-[10px] text-[#718078]">{user.email}</div></div>
          <button className="btn" onClick={onSignOut}><Icon n="logout" />Sign out</button>
        </header>
        <main className="p-4 max-w-[1500px] mx-auto">{children}</main>
      </div>
    </div>
  );
}
