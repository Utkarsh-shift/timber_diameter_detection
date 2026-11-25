import { get } from './db.js';

const clients = new Set();

export function sseHandler(req, res) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('event: hello\ndata: {}\n\n');
  res.cid = req.cid; // the stream is tied to the signed-in company
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// Events are only nudges to refetch. A truck event goes to the company that owns the truck, and nothing but
// the telemetry tick carries a payload.
export function broadcast(type, data = {}) {
  let cid = null;
  if (type === 'truck') cid = get('SELECT company_id FROM trucks WHERE id=?', data.id)?.company_id || null;
  const msg = `event: ${type}\ndata: ${JSON.stringify(type === 'tick' ? data : {})}\n\n`;
  for (const c of clients) if (!cid || c.cid === cid) c.write(msg);
}
