// Lighthouse — root App component.
import { useEffect, useState } from 'react';
import type { View, ViewPage } from '@lighthouse/shared';
import { StatusDot, Kbd, Icon } from './primitives';
import { Overview, ServiceDetail } from './screens';
import { NetworkMap, DeployFeed, CommandPalette } from './screens2';
import { useServices } from './lib/hooks';

const VIEW_STORAGE_KEY = 'lighthouse-view';

export default function App() {
  const [view, setView] = useState<View>(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved) return JSON.parse(saved) as View;
    } catch {
      /* fall through */
    }
    return { page: 'overview' };
  });
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((p) => !p);
        return;
      }
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey && document.activeElement?.tagName !== 'INPUT') {
        const handler2 = (ev: KeyboardEvent) => {
          if (ev.key === 'o') setView({ page: 'overview' });
          else if (ev.key === 'n') setView({ page: 'network' });
          else if (ev.key === 'd') setView({ page: 'deploy' });
          window.removeEventListener('keydown', handler2, true);
        };
        window.addEventListener('keydown', handler2, true);
        setTimeout(() => window.removeEventListener('keydown', handler2, true), 1200);
        return;
      }
      if (e.key === 'Escape' && view.page === 'detail') {
        setView({ page: 'overview' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  let content: React.ReactNode;
  if (view.page === 'overview') content = <Overview onOpenService={(id) => setView({ page: 'detail', id })} />;
  else if (view.page === 'detail') content = <ServiceDetail id={view.id} onBack={() => setView({ page: 'overview' })} />;
  else if (view.page === 'network') content = <NetworkMap />;
  else if (view.page === 'deploy') content = <DeployFeed />;

  return (
    <div className="lh-main-grid" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div className="lh-sidebar" style={{ display: 'contents' }}>
        <SidebarResponsive view={view} setView={setView} onOpenPalette={() => setPaletteOpen(true)} />
      </div>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {content}
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNav={setView} />
    </div>
  );
}

interface SidebarResponsiveProps {
  view: View;
  setView: (v: View) => void;
  onOpenPalette: () => void;
}

function SidebarResponsive({ view, setView, onOpenPalette }: SidebarResponsiveProps) {
  const { data: services = [] } = useServices();
  const items: Array<{ id: ViewPage; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <Icon.Grid /> },
    { id: 'network', label: 'Network', icon: <Icon.Network /> },
    { id: 'deploy', label: 'Deploy', icon: <Icon.Deploy /> },
  ];
  return (
    <aside className="lh-sidebar" style={{
      width: 220, flexShrink: 0,
      borderRight: '1px solid var(--border-subtle)',
      padding: '16px 12px',
      display: 'flex', flexDirection: 'column', gap: 4,
      background: 'var(--bg-base)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px 18px' }}>
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: 'linear-gradient(135deg, var(--accent), var(--data-alt))',
          position: 'relative', overflow: 'hidden',
          boxShadow: '0 0 20px -4px var(--accent-glow)',
          flexShrink: 0,
        }}>
          <div style={{ position: 'absolute', inset: 3, borderRadius: 3, background: 'var(--bg-base)' }}/>
          <div style={{ position: 'absolute', top: 7, left: 7, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }}/>
        </div>
        <div className="lh-brand-text" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>Lighthouse</span>
          <span className="mono" style={{ fontSize: 9, color: 'var(--fg-tertiary)' }}>horizon.rig</span>
        </div>
      </div>

      <button
        className="lh-jump"
        onClick={onOpenPalette}
        title="Jump to…"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px',
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--r-sm)',
          color: 'var(--fg-tertiary)',
          fontSize: 12,
          marginBottom: 10,
        }}
      >
        <Icon.Search />
        <span className="lh-jump-text" style={{ flex: 1, textAlign: 'left' }}>Jump to…</span>
        <span className="lh-jump-kbd"><Kbd>⌘K</Kbd></span>
      </button>

      <div className="lh-section lh-label" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-quaternary)', padding: '10px 8px 4px' }}>Workspace</div>
      {items.map((it) => (
        <button
          key={it.id}
          className="lh-nav-btn"
          onClick={() => setView({ page: it.id })}
          title={it.label}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 10px',
            borderRadius: 'var(--r-sm)',
            fontSize: 12.5,
            color: view.page === it.id ? 'var(--fg-primary)' : 'var(--fg-secondary)',
            background: view.page === it.id ? 'var(--bg-hover)' : 'transparent',
            border: view.page === it.id ? '1px solid var(--border-subtle)' : '1px solid transparent',
            textAlign: 'left',
            transition: 'background var(--dur-fast)',
          }}
        >
          <span style={{ color: view.page === it.id ? 'var(--accent)' : 'var(--fg-tertiary)' }}>{it.icon}</span>
          <span className="lh-label">{it.label}</span>
        </button>
      ))}

      <div className="lh-section lh-label" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-quaternary)', padding: '18px 8px 4px' }}>Services · {services.length}</div>
      <div className="lh-svc-list" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', marginRight: -4, paddingRight: 4 }}>
        {services.map((s) => (
          <button
            key={s.id}
            onClick={() => setView({ page: 'detail', id: s.id })}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 10px',
              borderRadius: 'var(--r-sm)',
              fontSize: 12,
              color: view.id === s.id ? 'var(--fg-primary)' : 'var(--fg-secondary)',
              background: view.id === s.id ? 'var(--bg-hover)' : 'transparent',
              border: view.id === s.id ? '1px solid var(--border-subtle)' : '1px solid transparent',
              textAlign: 'left',
              transition: 'background var(--dur-fast)',
            }}
          >
            <StatusDot status={s.status} size={6} pulse={false} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
          </button>
        ))}
      </div>

      <div className="lh-user-meta" style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 8px 0' }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-overlay)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--fg-secondary)', fontWeight: 600 }}>EZ</div>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11 }}>ezra</span>
          <span className="mono" style={{ fontSize: 9, color: 'var(--fg-tertiary)' }}>tailnet</span>
        </div>
        <StatusDot status="ok" size={6} pulse={false} />
      </div>
    </aside>
  );
}
