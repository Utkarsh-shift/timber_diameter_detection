import { Badge, Card, Kpi, Line, Loading, PageHead, Section, fmt } from '../ui.jsx';
import { useApi } from '../api.js';

export default function Models() {
  const { data: d } = useApi('/models', { live: ['tick', 'model'] });
  const { data: health } = useApi('/analysis/health');
  if (!d) return <Loading />;
  const k = d.kpis;
  const last = d.series[d.series.length - 1];

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Detector Models" />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Kpi label="Active Profile" value={k.arch?.replace('ellipse-', '')} sub={health?.up ? `OpenCV ${health.opencv}` : 'service offline'} foot={health?.up ? 'ONLINE' : 'OFFLINE'} tone={health?.up ? 'ok' : 'bad'} />
        <Kpi label="Photo Analysis Time" value={k.live_ms != null ? fmt(k.live_ms) : '–'} unit="ms" sub={k.live_ms != null ? `avg of ${k.photos} uploaded photo${k.photos > 1 ? 's' : ''}` : 'no photos analysed yet'} />
        <Kpi label="Photos Analysed" value={fmt(k.photos || 0)} />
      </div>

      <Section title="Inference Time per Photo" sub="Latest samples (ms per detected log) from analyses">
        <Line series={[d.series.map((s) => s.latency)]} height={150} />
        <div className="mono text-[10px] text-[#718078] mt-1">Latest: {last?.latency} ms/log • {last?.fps} photos/s</div>
      </Section>

      <Section title="Inference Hosts" sub="Real resource use of the services running this demo" right={<Badge tone={health?.up ? 'ok' : 'bad'}>{health?.up ? 'ALL SERVICES UP' : 'ANALYSIS DOWN'}</Badge>}>
        <div className="grid md:grid-cols-2 gap-3">{d.nodes.map((n) => <Card key={n.id} className="p-3"><div className="flex justify-between"><b className="mono text-[12px]">● {n.id}</b><Badge tone="ok">{n.status}</Badge></div><div className="text-[11px] text-[#718078] my-1">{n.descr}</div><div className="mono text-[11px]">Memory: {n.vram} / {n.cap} GB ({n.unit})</div><div className="h-1 bg-[#e2e8e2] rounded mt-1"><div className="h-1 bg-[#173f35] rounded" style={{ width: Math.min(100, (n.vram / n.cap) * 100) + '%' }} /></div></Card>)}</div>
      </Section>
    </div>
  );
}
