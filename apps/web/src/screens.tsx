// Lighthouse screens — TopBar, ServiceCard, Overview, ServiceDetail
// Wired to the real API via hooks from ./lib/hooks. Sparklines for
// overview summary are still seeded locally until /services/metrics/batch lands.
import React, { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LogLevel, Service, ServiceMetrics, ServiceStatus } from '@lighthouse/shared';
import { spark } from './data';
import { StatusDot, Button, Sparkline, Badge, Icon } from './primitives';
import {
  useRestartService,
  useRedeployService,
  useService,
  useServiceLogsStream,
  useServiceMetrics,
  useServices,
} from './lib/hooks';

// ── TopBar ─────────────────────────────────────────────────────────────────
interface TopBarProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  breadcrumbs?: string[];
}

export function TopBar({ title, subtitle, right, breadcrumbs }: TopBarProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '14px 24px',
      borderBottom: '1px solid var(--border-subtle)',
      minHeight: 56,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {breadcrumbs && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--fg-tertiary)', marginBottom: 2 }}>
            {breadcrumbs.map((b, i) => (
              <React.Fragment key={i}>
                {i > 0 && <Icon.ChevronRight />}
                <span>{b}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</h1>
          {subtitle && <span style={{ fontSize: 12, color: 'var(--fg-tertiary)' }}>{subtitle}</span>}
        </div>
      </div>
      {right}
    </div>
  );
}

// ── ServiceCard with hover-expand ──────────────────────────────────────────
interface ServiceCardProps {
  svc: Service;
  onClick: () => void;
  hovered: boolean;
  onHover: (id: string | null) => void;
}

function ServiceCard({ svc, onClick, hovered, onHover }: ServiceCardProps) {
  const isExpanded = hovered;
  return (
    <div
      tabIndex={0}
      role="button"
      onClick={onClick}
      onMouseEnter={() => onHover(svc.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(svc.id)}
      onBlur={() => onHover(null)}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      style={{
        position: 'relative',
        background: 'var(--bg-raised)',
        border: `1px solid ${isExpanded ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--r-lg)',
        padding: 14,
        cursor: 'pointer',
        transition: 'border-color var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-spring), box-shadow var(--dur-base) var(--ease-out)',
        transform: isExpanded ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: isExpanded ? 'var(--shadow-md)' : 'none',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <StatusDot status={svc.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>{svc.name}</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-tertiary)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{svc.host}</div>
        </div>
        <div style={{
          opacity: isExpanded ? 1 : 0,
          transition: 'opacity var(--dur-base)',
          color: 'var(--fg-tertiary)',
        }}>
          <Icon.ChevronRight />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="mono tabular" style={{ fontSize: 13, fontWeight: 500 }}>{svc.cpu.toFixed(1)}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-tertiary)' }}>% cpu</span>
          </div>
          {svc.cpuSpark.length > 1 && <Sparkline data={svc.cpuSpark} width={100} height={22} color="var(--accent)" live={svc.status === 'ok' || svc.status === 'warn'} />}
        </div>
        <div style={{ width: 1, height: 28, background: 'var(--border-subtle)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="mono tabular" style={{ fontSize: 13, fontWeight: 500 }}>{svc.ram >= 1000 ? (svc.ram/1024).toFixed(1) : svc.ram}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-tertiary)' }}>{svc.ram >= 1000 ? 'GB' : 'MB'} ram</span>
          </div>
          {svc.ramSpark.length > 1 && <Sparkline data={svc.ramSpark} width={100} height={22} color="var(--data-alt)" live={svc.status === 'ok' || svc.status === 'warn'} />}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: 'var(--fg-tertiary)' }}>
        <span className="mono">{svc.uptime}</span>
        <span>·</span>
        <span className="mono">{svc.version}</span>
        {svc.alert && (
          <>
            <span style={{ marginLeft: 'auto' }}/>
            <Badge tone={svc.status === 'error' ? 'error' : 'warn'}>{svc.alert}</Badge>
          </>
        )}
      </div>

      <div style={{
        maxHeight: isExpanded ? 88 : 0,
        opacity: isExpanded ? 1 : 0,
        overflow: 'hidden',
        transition: 'max-height var(--dur-base) var(--ease-spring), opacity var(--dur-base) var(--ease-out), margin-top var(--dur-base) var(--ease-out)',
        marginTop: isExpanded ? 2 : 0,
        borderTop: '1px solid var(--border-subtle)',
        paddingTop: isExpanded ? 10 : 0,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', gap: 10, fontSize: 10.5 }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'var(--fg-quaternary)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>net in</div>
            <div className="mono tabular">{svc.netIn.toFixed(1)} <span style={{ color: 'var(--fg-tertiary)' }}>MB/s</span></div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'var(--fg-quaternary)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>net out</div>
            <div className="mono tabular">{svc.netOut.toFixed(1)} <span style={{ color: 'var(--fg-tertiary)' }}>MB/s</span></div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'var(--fg-quaternary)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>image</div>
            <div className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{svc.image.split(':')[0].split('/').pop()}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" variant="accent" icon={<Icon.ExternalLink />} onClick={(e) => { e.stopPropagation(); }}>Open</Button>
          <Button size="sm" icon={<Icon.Terminal />} onClick={(e) => { e.stopPropagation(); }}>Logs</Button>
          <Button size="sm" icon={<Icon.Restart />} onClick={(e) => { e.stopPropagation(); }}>Restart</Button>
        </div>
      </div>
    </div>
  );
}

// ── Overview screen ────────────────────────────────────────────────────────
interface OverviewProps {
  onOpenService: (id: string) => void;
}

type OverviewFilter = 'all' | ServiceStatus;

export function Overview({ onOpenService }: OverviewProps) {
  const { data: services = [], isLoading, isError, error } = useServices();
  const [hovered, setHovered] = useState<string | null>(null);
  const [filter, setFilter] = useState<OverviewFilter>('all');

  const counts = {
    all: services.length,
    ok: services.filter((s) => s.status === 'ok').length,
    warn: services.filter((s) => s.status === 'warn').length,
    error: services.filter((s) => s.status === 'error').length,
    idle: services.filter((s) => s.status === 'idle').length,
    deploying: services.filter((s) => s.status === 'deploying').length,
  };
  const filtered = filter === 'all' ? services : services.filter((s) => s.status === filter);
  const totalCpu = services.reduce((a, s) => a + s.cpu, 0);
  const totalRam = services.reduce((a, s) => a + s.ram, 0);
  const totalRamMax = services.reduce((a, s) => a + s.ramMax, 0);

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <TopBar
        title="Overview"
        subtitle={<span className="mono">{counts.all} services · {counts.ok} healthy · {counts.warn} degraded · {counts.error} down</span>}
        right={<div style={{ display: 'flex', gap: 8 }}>
          <Button size="md" icon={<Icon.Filter />}>Filter</Button>
          <Button size="md" variant="primary" icon={<Icon.Plus />}>Add service</Button>
        </div>}
      />

      {isError && <ErrorStrip error={error as Error} />}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 1, background: 'var(--border-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        {[
          { label: 'CPU load', val: totalCpu.toFixed(1), unit: '%', sparkSeed: 1, color: 'var(--accent)' },
          { label: 'Memory', val: (totalRam/1024).toFixed(1), unit: `/ ${(totalRamMax/1024).toFixed(0)} GB`, sparkSeed: 2, color: 'var(--data-alt)' },
          { label: 'Services online', val: counts.ok, unit: 'healthy', sparkSeed: 3, color: 'var(--status-ok)' },
          { label: 'Alerts', val: counts.warn + counts.error, unit: `${counts.warn} warn · ${counts.error} err`, sparkSeed: 4, color: 'var(--accent)' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'var(--bg-base)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-tertiary)' }}>{s.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
                <span className="mono tabular" style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em' }}>{s.val}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-tertiary)' }}>{s.unit}</span>
              </div>
            </div>
            <Sparkline data={spark(s.sparkSeed, 48, 20, 20)} width={60} height={28} color={s.color} />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '16px 24px 8px', alignItems: 'center' }}>
        {([
          { id: 'all' as OverviewFilter, label: 'All' },
          { id: 'ok' as OverviewFilter, label: 'Healthy', tone: 'ok' as const },
          { id: 'warn' as OverviewFilter, label: 'Degraded', tone: 'warn' as const },
          { id: 'error' as OverviewFilter, label: 'Down', tone: 'error' as const },
          { id: 'idle' as OverviewFilter, label: 'Stopped' },
        ]).map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 10px',
              fontSize: 11,
              borderRadius: 'var(--r-full)',
              background: filter === f.id ? 'var(--bg-hover)' : 'transparent',
              border: `1px solid ${filter === f.id ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
              color: filter === f.id ? 'var(--fg-primary)' : 'var(--fg-secondary)',
              transition: 'all var(--dur-fast)',
            }}
          >
            {f.tone && <StatusDot status={f.tone} size={6} pulse={false} />}
            {f.label}
            <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>{counts[f.id]}</span>
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-tertiary)' }} className="mono">
          auto-refresh · <span style={{ color: 'var(--status-ok)' }}>●</span> 5s
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 10,
        padding: '8px 24px 32px',
      }}>
        {isLoading
          ? Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)
          : filtered.map((svc) => (
              <ServiceCard
                key={svc.id}
                svc={svc}
                hovered={hovered === svc.id}
                onHover={setHovered}
                onClick={() => onOpenService(svc.id)}
              />
            ))}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div
      className="grid-texture"
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--r-lg)',
        height: 128,
        opacity: 0.5,
      }}
    />
  );
}

function ErrorStrip({ error }: { error: Error | null }) {
  return (
    <div
      style={{
        padding: '10px 24px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--status-error-bg)',
      }}
    >
      <StatusDot status="error" />
      <span className="mono" style={{ fontSize: 11, color: 'var(--status-error)' }}>
        {error?.message || 'api unreachable'}
      </span>
    </div>
  );
}

// ── Service Detail ─────────────────────────────────────────────────────────
interface ServiceDetailProps {
  id: string | undefined;
  onBack: () => void;
}

type LogFilter = 'all' | LogLevel;

export function ServiceDetail({ id }: ServiceDetailProps) {
  const svcQ = useService(id);
  const metricsQ = useServiceMetrics(id, '5m');
  const logs = useServiceLogsStream(id);
  const restart = useRestartService();
  const redeploy = useRedeployService();
  const [lvlFilter, setLvlFilter] = useState<LogFilter>('all');
  const [wrap, setWrap] = useState(false);
  const logsRef = useRef<HTMLDivElement | null>(null);

  const visibleLogs = lvlFilter === 'all' ? logs : logs.filter((l) => l.lvl === lvlFilter);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [lvlFilter, logs.length]);

  if (!id) return <div style={{ padding: 24, color: 'var(--fg-tertiary)' }}>no service selected</div>;
  if (svcQ.isLoading) return <div className="grid-texture" style={{ flex: 1, opacity: 0.5 }} />;
  if (svcQ.isError || !svcQ.data) {
    return (
      <div style={{ padding: 24, display: 'flex', gap: 10, alignItems: 'center' }}>
        <StatusDot status="error" />
        <span className="mono" style={{ color: 'var(--status-error)' }}>
          {(svcQ.error as Error | null)?.message || 'service not found'}
        </span>
      </div>
    );
  }

  const svc = svcQ.data;
  const cpuSpark = seriesToSpark(metricsQ.data?.cpu.points) ?? svc.cpuSpark;
  const ramSpark = seriesToSpark(metricsQ.data?.ram.points) ?? svc.ramSpark;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        breadcrumbs={['Overview', 'Services']}
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <StatusDot status={svc.status} size={10} />
          {svc.name}
        </span>}
        subtitle={<span className="mono">{svc.host} · {svc.version}</span>}
        right={<div style={{ display: 'flex', gap: 6 }}>
          <Button size="md" variant="accent" icon={<Icon.ExternalLink />}>Open in Tailscale</Button>
          <Button size="md" icon={<Icon.Restart />} disabled={restart.isPending} onClick={() => restart.mutate(svc.id)}>
            {restart.isPending ? 'Restarting…' : 'Restart'}
          </Button>
          <Button size="md" variant="primary" icon={<Icon.Deploy />} disabled={redeploy.isPending} onClick={() => redeploy.mutate(svc.id)}>
            {redeploy.isPending ? 'Queued…' : 'Redeploy'}
          </Button>
        </div>}
      />

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 1, background: 'var(--border-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        {([
          { label: 'Uptime', val: svc.uptime },
          { label: 'CPU', val: `${svc.cpu.toFixed(1)}%`, spark: cpuSpark, color: 'var(--accent)' },
          { label: 'Memory', val: `${svc.ram}MB / ${(svc.ramMax/1024).toFixed(1)}GB`, spark: ramSpark, color: 'var(--data-alt)' },
          { label: 'Net in', val: `${svc.netIn.toFixed(1)} MB/s` },
          { label: 'Container', val: svc.container || '—', trunc: true },
        ] as Array<{ label: string; val: string; spark?: number[]; color?: string; trunc?: boolean }>).map((s, i) => (
          <div key={i} style={{ background: 'var(--bg-base)', padding: '14px 20px' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-tertiary)' }}>{s.label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <span className="mono tabular" style={{
                fontSize: 14, fontWeight: 500,
                overflow: s.trunc ? 'hidden' : 'visible',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: s.trunc ? 120 : 'none',
              }}>{s.val}</span>
              {s.spark && s.spark.length > 1 && <Sparkline data={s.spark} width={50} height={22} color={s.color} live />}
            </div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: 11,
          }}>
            <Icon.Terminal />
            <span style={{ color: 'var(--fg-secondary)' }}>Logs</span>
            <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>tail -f · {visibleLogs.length} lines · {svc.container || 'bare-metal'}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
              {(['all', 'info', 'warn', 'error'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLvlFilter(l)}
                  style={{
                    padding: '3px 8px', fontSize: 10,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    borderRadius: 'var(--r-xs)',
                    background: lvlFilter === l ? 'var(--bg-hover)' : 'transparent',
                    border: `1px solid ${lvlFilter === l ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
                    color: lvlFilter === l ? 'var(--fg-primary)' : 'var(--fg-tertiary)',
                  }}
                >{l}</button>
              ))}
              <div style={{ width: 1, height: 18, background: 'var(--border-subtle)', margin: '0 6px' }} />
              <Button size="sm" icon={<Icon.Copy />} onClick={() => setWrap((w) => !w)}>{wrap ? 'nowrap' : 'wrap'}</Button>
              <Button size="sm" icon={<Icon.ExternalLink />}>Export</Button>
            </div>
          </div>
          <div ref={logsRef} style={{ flex: 1, overflow: 'auto', padding: '10px 20px', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.7 }}>
            {visibleLogs.length === 0 && (
              <div style={{ color: 'var(--fg-tertiary)', padding: '20px 0' }}>
                streaming · no log lines yet
              </div>
            )}
            {visibleLogs.map((l, i) => (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: '88px 52px 1fr',
                gap: 10,
                padding: '1px 0',
                color: l.lvl === 'error' ? 'var(--status-error)' : l.lvl === 'warn' ? 'var(--status-warn)' : 'var(--fg-secondary)',
              }}>
                <span style={{ color: 'var(--fg-quaternary)' }}>{l.t}</span>
                <span style={{
                  fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: l.lvl === 'error' ? 'var(--status-error)' : l.lvl === 'warn' ? 'var(--status-warn)' : 'var(--fg-tertiary)',
                }}>{l.lvl}</span>
                <span style={{
                  color: l.lvl === 'info' ? 'var(--fg-primary)' : undefined,
                  opacity: l.lvl === 'info' ? 0.78 : 1,
                  whiteSpace: wrap ? 'pre-wrap' : 'nowrap',
                  overflow: wrap ? 'visible' : 'hidden',
                  textOverflow: 'ellipsis',
                }}>{l.msg}</span>
              </div>
            ))}
            <div className="mono" style={{ color: 'var(--accent)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 12, background: 'var(--accent)', display: 'inline-block', animation: 'blink 1s steps(2) infinite' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function seriesToSpark(points: ServiceMetrics['cpu']['points'] | undefined): number[] | null {
  if (!points || points.length < 2) return null;
  return points.map((p) => p.v);
}
