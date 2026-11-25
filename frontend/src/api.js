import { useCallback, useEffect, useRef, useState } from 'react';

// the session cookie identifies the user and therefore the company; a 401 anywhere sends the app back to the sign-in screen
export async function call(path, method = 'GET', body) {
  const res = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('signed-out'));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}
export const post = (p, b = {}) => call(p, 'POST', b);
export const patch = (p, b = {}) => call(p, 'PATCH', b);

// one shared SSE connection; listeners are notified on every server event
const listeners = new Set();
let es;
function ensureStream() {
  if (es || location.search.includes('nostream')) return; // ?nostream is used for headless screenshots
  es = new EventSource('/api/stream');
  ['tick', 'truck', 'quality', 'rig', 'model'].forEach((t) => es.addEventListener(t, (e) => listeners.forEach((l) => l(t, e))));
  es.addEventListener('open', () => listeners.forEach((l) => l('open')));
  es.onerror = () => listeners.forEach((l) => l('error'));
}
export function useStream(fn) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => { ensureStream(); const l = (t, e) => ref.current(t, e); listeners.add(l); return () => listeners.delete(l); }, []);
}

// fetch + auto-refresh when the simulator emits one of the `live` events (e.g. ['tick', 'truck'])
export function useApi(path, { live = [] } = {}) {
  const [data, setData] = useState(null); const [error, setError] = useState(null);
  const load = useCallback(() => (path ? call(path).then((d) => { setData(d); setError(null); }).catch(setError) : Promise.resolve()), [path]); // a falsy path waits
  useEffect(() => { setData(null); load(); }, [load]);
  useStream((t) => { if (live.includes(t)) load(); });
  return { data, error, reload: load, setData };
}
