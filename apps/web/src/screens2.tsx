// Lighthouse — Network map, Deploy feed, Command palette. All wired to the API.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DeployStatus, ServiceStatus, TailnetEdge, TailnetNode, Tone, View } from '@lighthouse/shared';
import { spark } from './data';
import { StatusDot, Button, Badge, Kbd, Sparkline, Icon } from './primitives';
import { TopBar } from './screens';
import {
  useCancelDeploy,
  useDeploy,
  useDeployEventsStream,
  useDeploys,
  useRollback,
  useServices,
  useTailnetDevices,
} from './lib/hooks';

// Synthesize edges from a device list for the map view. The API doesn't return
// peer-to-peer links yet (step 5.5 — tailscaled local socket), so we model every
// non-self node as having an active edge to the self node.
function synthesizeEdges(nodes: TailnetNode[]): TailnetEdge[] {
  const self = nodes.find((n) => n.role === 'self');
  if (!self) return [];
  return nodes
    .filter((n) => n.id !== self.id)
    .map<TailnetEdge>((n) => [self.id, n.id, n.latency, n.latency < 50 ? 'active' : 'idle']);
}

// ── Network Map ────────────────────────────────────────────────────────────
export function NetworkMap() {
  const { data: nodes = [], isLoading, isError, error } = useTailnetDevices();
  const edges = useMemo(() => synthesizeEdges(nodes), [nodes]);

  const [selected, setSelected] = useState<string>('');
  useEffect(() => {
    if (nodes.length > 0 && !selected) setSelected(nodes[0]!.id);
  }, [nodes, selected]);

  const [traffic, setTraffic] = useState<{ edge?: string; stamp?: number }>({});
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dims, setDims] = useState({ w: 900, h: 560 });

  useEffect(() => {
    const t = setInterval(() => {
      const active = edges.filter((e) => e[3] === 'active');
      if (active.length === 0) return;
      const pick = active[Math.floor(Math.random() * active.length)]!;
      setTraffic({ edge: `${pick[0]}-${pick[1]}`, stamp: Date.now() });
    }, 900);
    return () => clearInterval(t);
  }, [edges]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setDims({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pos = (n: TailnetNode) => ({ x: n.x * dims.w, y: n.y * dims.h });
  const selectedNode = nodes.find((n) => n.id === selected);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        title="Network"
        subtitle={<span className="mono">tailnet · {nodes.length} peers{nodes.some((n) => n.exitNode) ? ' · 1 exit node' : ''}</span>}
        right={<div style={{ display: 'flex', gap: 6 }}>
          <Button size="md" icon={<Icon.Zap />}>Refresh routes</Button>
          <Button size="md" variant="primary" icon={<Icon.Plus />}>Add device</Button>
        </div>}
      />
      {isError && (
        <div style={{ padding: '10px 24px', display: 'flex', gap: 10, alignItems: 'center', background: 'var(--status-error-bg)' }}>
          <StatusDot status="error" />
          <span className="mono" style={{ fontSize: 11, color: 'var(--status-error)' }}>
            {(error as Error).message}
          </span>
        </div>
      )}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 320px', overflow: 'hidden', minHeight: 0 }}>
        <div className="grid-texture" style={{ position: 'relative', overflow: 'hidden', borderRight: '1px solid var(--border-subtle)' }}>
          {isLoading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-tertiary)', fontSize: 12 }}>
              loading peers…
            </div>
          )}
          <svg ref={svgRef} width="100%" height="100%" style={{ display: 'block', position: 'absolute', inset: 0 }}>
            <defs>
              <radialGradient id="node-glow">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4"/>
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
              </radialGradient>
              <radialGradient id="node-glow-self">
                <stop offset="0%" stopColor="var(--data-alt)" stopOpacity="0.5"/>
                <stop offset="100%" stopColor="var(--data-alt)" stopOpacity="0"/>
              </radialGradient>
            </defs>

            {nodes.filter((n) => n.subnet).map((n, i) => {
              const p = pos(n);
              return (
                <g key={`sub-${i}`}>
                  <circle cx={p.x} cy={p.y} r="72" fill="none" stroke="var(--border-accent)" strokeWidth="1" strokeDasharray="2 4" opacity="0.6" />
                  <text x={p.x + 76} y={p.y - 58} className="mono" fontSize="9" fill="var(--accent)" opacity="0.8">subnet · {n.subnet}</text>
                </g>
              );
            })}

            {edges.map(([a, b, lat, state], i) => {
              const na = nodes.find((n) => n.id === a);
              const nb = nodes.find((n) => n.id === b);
              if (!na || !nb) return null;
              const pa = pos(na), pb = pos(nb);
              const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
              const isPulsing = traffic.edge === `${a}-${b}`;
              return (
                <g key={i}>
                  <line
                    x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                    stroke={state === 'active' ? 'var(--border-strong)' : 'var(--border-subtle)'}
                    strokeWidth="1"
                    strokeDasharray={state === 'idle' ? '2 3' : '0'}
                  />
                  {isPulsing && (
                    <circle r="3" fill="var(--accent)" opacity="0.9">
                      <animate attributeName="cx" values={`${pa.x};${pb.x}`} dur="0.9s" />
                      <animate attributeName="cy" values={`${pa.y};${pb.y}`} dur="0.9s" />
                      <animate attributeName="opacity" values="1;0" dur="0.9s" />
                    </circle>
                  )}
                  <text x={mid.x} y={mid.y - 6} textAnchor="middle" className="mono" fontSize="9" fill="var(--fg-tertiary)">{lat}ms</text>
                </g>
              );
            })}

            {nodes.map((n) => {
              const p = pos(n);
              const isSelf = n.role === 'self';
              const isSelected = n.id === selected;
              return (
                <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(n.id)}>
                  <circle cx={p.x} cy={p.y} r="32" fill={isSelf ? 'url(#node-glow-self)' : 'url(#node-glow)'} opacity={isSelected ? 1 : 0.5} />
                  <circle
                    cx={p.x} cy={p.y} r="14"
                    fill="var(--bg-overlay)"
                    stroke={isSelected ? 'var(--accent)' : isSelf ? 'var(--data-alt)' : 'var(--border-strong)'}
                    strokeWidth={isSelected ? 1.5 : 1}
                  />
                  <circle cx={p.x} cy={p.y} r="3" fill={n.exitNode ? 'var(--status-warn)' : isSelf ? 'var(--data-alt)' : 'var(--status-ok)'}>
                    <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
                  </circle>
                  {n.exitNode && (
                    <path d={`M ${p.x - 8} ${p.y - 10} L ${p.x - 4} ${p.y - 14} L ${p.x} ${p.y - 10}`} stroke="var(--status-warn)" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                  <text x={p.x} y={p.y + 30} textAnchor="middle" fontSize="11" fontWeight="500" fill="var(--fg-primary)">{n.name}</text>
                  <text x={p.x} y={p.y + 43} textAnchor="middle" className="mono" fontSize="9.5" fill="var(--fg-tertiary)">{n.ip}</text>
                </g>
              );
            })}
          </svg>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-base)' }}>
          {selectedNode && <NodeInspector node={selectedNode} />}
        </div>
      </div>
    </div>
  );
}

function NodeInspector({ node }: { node: TailnetNode }) {
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div style={{ padding: 20, borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8,
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border-default)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent)',
          }}><Icon.Server /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{node.name}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--fg-tertiary)' }}>{node.os}</div>
          </div>
          {node.exitNode && <Badge tone="warn">exit node</Badge>}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <Button size="sm" variant="accent" icon={<Icon.ExternalLink />}>SSH</Button>
          <Button size="sm" icon={<Icon.Copy />}>Copy IP</Button>
          <Button size="sm">Ping</Button>
        </div>
      </div>

      <dl style={{ padding: '8px 20px', display: 'grid', gridTemplateColumns: '90px 1fr', gap: '8px 16px', fontSize: 12, alignItems: 'baseline' }}>
        <dt style={{ color: 'var(--fg-tertiary)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tailscale IP</dt>
        <dd className="mono">{node.ip}</dd>
        <dt style={{ color: 'var(--fg-tertiary)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Latency</dt>
        <dd className="mono tabular">{node.latency} ms</dd>
        <dt style={{ color: 'var(--fg-tertiary)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Role</dt>
        <dd style={{ textTransform: 'capitalize' }}>{node.role}</dd>
        {node.subnet && <>
          <dt style={{ color: 'var(--fg-tertiary)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Subnet</dt>
          <dd className="mono"><Badge tone="accent" mono>{node.subnet}</Badge></dd>
        </>}
      </dl>

      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-tertiary)', marginBottom: 8 }}>Traffic (synthetic)</div>
        <Sparkline data={spark(node.id.length * 7, 64, 40, 40)} width={280} height={48} color="var(--accent)" live />
      </div>
    </div>
  );
}

// ── Deploy feed ────────────────────────────────────────────────────────────
const DEPLOY_STATUS_TONE: Record<DeployStatus, Tone> = {
  success: 'ok',
  running: 'accent',
  failed: 'error',
  'rolled-back': 'warn',
};

function depStatusToDot(s: DeployStatus): ServiceStatus {
  if (s === 'success') return 'ok';
  if (s === 'running') return 'deploying';
  if (s === 'failed') return 'error';
  return 'warn';
}

export function DeployFeed() {
  const { data: deploys = [], isLoading, isError, error } = useDeploys();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!selected && deploys.length > 0) setSelected(deploys[0]!.id);
  }, [deploys, selected]);
  const { data: detail } = useDeploy(selected ?? undefined);
  const stageEvents = useDeployEventsStream(detail?.status === 'running' ? selected ?? undefined : undefined);
  const rollback = useRollback();
  const cancel = useCancelDeploy();

  const dep = detail ?? deploys.find((d) => d.id === selected) ?? deploys[0];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        title="Deploy"
        subtitle={<span className="mono">{deploys.length} deploys · {deploys.filter((d) => d.status === 'success').length} ok · {deploys.filter((d) => d.status === 'running').length} running</span>}
        right={<div style={{ display: 'flex', gap: 6 }}>
          <Button size="md" icon={<Icon.Branch />}>Branches</Button>
          <Button size="md" variant="primary" icon={<Icon.Deploy />}>New deploy</Button>
        </div>}
      />
      {isError && (
        <div style={{ padding: '10px 24px', display: 'flex', gap: 10, alignItems: 'center', background: 'var(--status-error-bg)' }}>
          <StatusDot status="error" />
          <span className="mono" style={{ fontSize: 11, color: 'var(--status-error)' }}>
            {(error as Error).message}
          </span>
        </div>
      )}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '360px 1fr', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ borderRight: '1px solid var(--border-subtle)', overflow: 'auto' }}>
          {isLoading && <div style={{ padding: 20, color: 'var(--fg-tertiary)', fontSize: 12 }}>loading deploys…</div>}
          {!isLoading && deploys.length === 0 && (
            <div style={{ padding: 20, color: 'var(--fg-tertiary)', fontSize: 12 }}>no deploys yet — push to Gitea to trigger one</div>
          )}
          {deploys.map((d) => {
            const isSel = d.id === selected;
            return (
              <button
                key={d.id}
                onClick={() => setSelected(d.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '14px 16px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: isSel ? 'var(--bg-hover)' : 'transparent',
                  borderLeft: `2px solid ${isSel ? 'var(--accent)' : 'transparent'}`,
                  display: 'flex', flexDirection: 'column', gap: 6,
                  cursor: 'pointer',
                  transition: 'background var(--dur-fast)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StatusDot status={depStatusToDot(d.status)} size={6} pulse={d.status === 'running'} />
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{d.service}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--fg-tertiary)' }}>{d.branch}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--fg-tertiary)' }}>{d.sha.slice(0, 7)}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--fg-tertiary)' }}>{d.when}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-secondary)', textWrap: 'pretty' as 'pretty' }}>{d.msg}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10.5, color: 'var(--fg-tertiary)' }}>
                  <span className="mono"><span style={{ color: 'var(--status-ok)' }}>+{d.diff.added}</span> <span style={{ color: 'var(--status-error)' }}>−{d.diff.removed}</span></span>
                  <span>{d.diff.files} files</span>
                  <span className="mono">{d.duration}</span>
                  <Badge tone={DEPLOY_STATUS_TONE[d.status]}>{d.status}</Badge>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {!dep && <div style={{ padding: 24, color: 'var(--fg-tertiary)' }}>select a deploy</div>}
          {dep && (
            <>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Badge tone={DEPLOY_STATUS_TONE[dep.status]}>{dep.status}</Badge>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{dep.service}</span>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--fg-tertiary)' }}>{dep.branch} · {dep.sha.slice(0, 7)}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {dep.status === 'success' && <Button size="md" variant="danger" icon={<Icon.Restart />} onClick={() => rollback.mutate(dep.id)}>Rollback</Button>}
                    {dep.status === 'running' && <Button size="md" variant="danger" icon={<Icon.X />} onClick={() => cancel.mutate(dep.id)}>Cancel</Button>}
                    <Button size="md" icon={<Icon.ExternalLink />}>Logs</Button>
                  </div>
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--fg-primary)' }}>{dep.msg}</div>
                <div style={{ display: 'flex', gap: 24, fontSize: 11, color: 'var(--fg-tertiary)' }}>
                  <span><span style={{ color: 'var(--fg-quaternary)' }}>author</span> <span style={{ color: 'var(--fg-secondary)', marginLeft: 6 }}>{dep.author}</span></span>
                  <span><span style={{ color: 'var(--fg-quaternary)' }}>duration</span> <span className="mono" style={{ color: 'var(--fg-secondary)', marginLeft: 6 }}>{dep.duration}</span></span>
                </div>
                {dep.error && (
                  <div style={{ background: 'var(--status-error-bg)', border: '1px solid color-mix(in oklch, var(--status-error) 30%, transparent)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 11.5, color: 'var(--status-error)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon.X /> <span className="mono">{dep.error}</span>
                  </div>
                )}
              </div>

              <PipelineStepper status={dep.status} liveEvents={stageEvents} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PipelineStepper({ status, liveEvents }: { status: DeployStatus; liveEvents: ReturnType<typeof useDeployEventsStream> }) {
  const stages: Array<{ label: string; status: ServiceStatus; dur: string }> = [
    { label: 'checkout', status: 'idle', dur: '—' },
    { label: 'build', status: 'idle', dur: '—' },
    { label: 'test', status: 'idle', dur: '—' },
    { label: 'deploy', status: 'idle', dur: '—' },
    { label: 'healthcheck', status: 'idle', dur: '—' },
  ];
  for (const ev of liveEvents) {
    const s = stages.find((x) => x.label === ev.stage);
    if (!s) continue;
    s.status = ev.status === 'ok' ? 'ok' : ev.status === 'error' ? 'error' : ev.status === 'started' ? 'deploying' : 'idle';
    if (ev.durationMs) s.dur = formatDur(ev.durationMs);
  }
  // If no live events yet and the deploy is not running, assume the recorded
  // final status applies to all stages.
  if (liveEvents.length === 0 && status !== 'running') {
    const s: ServiceStatus = status === 'success' ? 'ok' : status === 'failed' ? 'error' : 'warn';
    for (const st of stages) st.status = s;
  }

  return (
    <div style={{ display: 'flex', gap: 0, padding: '14px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
      {stages.map((s, i, arr) => (
        <React.Fragment key={s.label}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, minWidth: 120 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <StatusDot status={s.status} size={7} />
              <span style={{ fontSize: 11, textTransform: 'capitalize', color: s.status === 'idle' ? 'var(--fg-tertiary)' : 'var(--fg-primary)' }}>{s.label}</span>
            </div>
            <span className="mono" style={{ fontSize: 10, color: 'var(--fg-tertiary)', marginLeft: 13 }}>{s.dur}</span>
          </div>
          {i < arr.length - 1 && <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)', alignSelf: 'center', maxWidth: 40 }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function formatDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Command palette ────────────────────────────────────────────────────────
type PaletteItem =
  | { kind: 'service'; id: string; label: string; hint: string; status: ServiceStatus; action: () => void }
  | { kind: 'nav'; id: string; label: string; hint: string; action: () => void }
  | { kind: 'action'; id: string; label: string; hint?: string; tone?: 'danger'; action?: () => void };

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNav: (view: View) => void;
}

export function CommandPalette({ open, onClose, onNav }: CommandPaletteProps) {
  const { data: services = [] } = useServices();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const items: PaletteItem[] = useMemo(() => {
    const base: PaletteItem[] = [
      ...services.map<PaletteItem>((s) => ({
        kind: 'service',
        id: s.id,
        label: s.name,
        hint: s.host,
        status: s.status,
        action: () => onNav({ page: 'detail', id: s.id }),
      })),
      { kind: 'nav', id: 'nav-overview', label: 'Go to Overview', hint: 'all services', action: () => onNav({ page: 'overview' }) },
      { kind: 'nav', id: 'nav-network', label: 'Go to Network map', hint: 'tailscale peers', action: () => onNav({ page: 'network' }) },
      { kind: 'nav', id: 'nav-deploy', label: 'Go to Deploy feed', hint: 'git-triggered', action: () => onNav({ page: 'deploy' }) },
    ];
    if (!q) return base;
    const needle = q.toLowerCase();
    return base.filter((i) => i.label.toLowerCase().includes(needle) || (i.hint && i.hint.toLowerCase().includes(needle)));
  }, [q, services, onNav]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  const runIdx = (n: number) => {
    const it = items[n];
    if (it?.action) it.action();
    onClose();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); runIdx(idx); }
    else if (e.key === 'Escape') onClose();
  };

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
        animation: 'fade-in 120ms var(--ease-out)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(620px, 92vw)',
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          animation: 'palette-in 200ms var(--ease-spring)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon.Search />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search services, actions, devices…"
            style={{ flex: 1, background: 'transparent', border: 0, outline: 'none', fontSize: 14 }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div style={{ maxHeight: 420, overflow: 'auto', padding: 6 }}>
          {items.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 12 }}>No matches</div>
          )}
          {items.map((it, i) => {
            let leftIcon: ReactNode;
            if (it.kind === 'service') leftIcon = <StatusDot status={it.status} size={6} pulse={false} />;
            else if (it.kind === 'nav') leftIcon = <span style={{ color: 'var(--fg-tertiary)' }}><Icon.ChevronRight /></span>;
            else leftIcon = <span style={{ color: it.tone === 'danger' ? 'var(--status-error)' : 'var(--accent)' }}><Icon.Zap /></span>;
            const labelColor = it.kind === 'action' && it.tone === 'danger' ? 'var(--status-error)' : 'var(--fg-primary)';
            return (
              <button
                key={it.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => runIdx(i)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '9px 12px',
                  borderRadius: 'var(--r-sm)',
                  background: idx === i ? 'var(--bg-hover)' : 'transparent',
                  border: idx === i ? '1px solid var(--border-subtle)' : '1px solid transparent',
                  display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'pointer',
                }}
              >
                {leftIcon}
                <span style={{ fontSize: 12.5, color: labelColor }}>{it.label}</span>
                {it.hint && <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-tertiary)' }}>{it.hint}</span>}
                {idx === i && <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}><Kbd>↵</Kbd></span>}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 14, padding: '8px 14px', borderTop: '1px solid var(--border-subtle)', fontSize: 10.5, color: 'var(--fg-tertiary)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Kbd>↵</Kbd> select</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Kbd>esc</Kbd> close</span>
          <span style={{ marginLeft: 'auto' }} className="mono">{items.length} results</span>
        </div>
      </div>
    </div>
  );
}
