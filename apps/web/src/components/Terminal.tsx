// In-browser terminal backed by `docker exec` — xterm.js on the client, a
// WebSocket to /api/v1/services/:id/terminal on the server.

import { useEffect, useRef } from 'react';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Button, Icon } from '../primitives';

interface TerminalPaneProps {
  serviceId: string;
  onClose: () => void;
}

export function TerminalPane({ serviceId, onClose }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new XTerminal({
      fontFamily: 'Geist Mono, ui-monospace, monospace',
      fontSize: 12.5,
      theme: {
        background: '#0a0a0a',
        foreground: '#eaeaea',
        cursor: '#bdfdff',
        cursorAccent: '#0a0a0a',
        selectionBackground: '#2a2a2a',
      },
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    term.focus();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/v1/services/${encodeURIComponent(serviceId)}/terminal`);
    ws.binaryType = 'arraybuffer';

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };

    ws.onopen = () => {
      term.writeln('\x1b[2m// connected\x1b[0m');
      sendResize();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        // Control / error messages are JSON text frames.
        try {
          const msg = JSON.parse(ev.data) as { type: string; message?: string };
          if (msg.type === 'error') term.writeln(`\x1b[31m// ${msg.message ?? 'error'}\x1b[0m`);
          return;
        } catch {
          term.write(ev.data);
          return;
        }
      }
      term.write(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onclose = () => term.writeln('\x1b[2m// disconnected\x1b[0m');
    ws.onerror = () => term.writeln('\x1b[31m// websocket error\x1b[0m');

    const onData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stdin', data }));
      }
    });
    const onResize = term.onResize(() => sendResize());

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* ignore */ }
    });
    ro.observe(host);

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && e.ctrlKey) onCloseRef.current(); };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      ro.disconnect();
      onData.dispose();
      onResize.dispose();
      try { ws.close(); } catch { /* ignore */ }
      term.dispose();
    };
  }, [serviceId]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        padding: '6vh 4vw',
        animation: 'fade-in 120ms var(--ease-out)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 1200,
          background: '#0a0a0a',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-raised)',
        }}>
          <Icon.Terminal />
          <span style={{ fontSize: 12, color: 'var(--fg-secondary)' }}>Terminal</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--fg-tertiary)' }}>{serviceId}</span>
          <div style={{ marginLeft: 'auto' }}>
            <Button size="sm" icon={<Icon.X />} onClick={onClose}>Close</Button>
          </div>
        </div>
        <div ref={hostRef} style={{ flex: 1, padding: 8 }} />
      </div>
    </div>
  );
}
