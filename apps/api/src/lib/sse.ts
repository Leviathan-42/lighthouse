import type { FastifyReply, FastifyRequest } from 'fastify';

// Tiny SSE helper. Writes headers, pings every 15s to keep proxies happy,
// and cleans up when the client disconnects.

export interface SseStream {
  send: (event: string, data: unknown) => void;
  close: () => void;
  onClose: (fn: () => void) => void;
}

export function openSse(req: FastifyRequest, reply: FastifyReply): SseStream {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  raw.write(': connected\n\n');

  const ping = setInterval(() => raw.write(': ping\n\n'), 15_000);
  const listeners: Array<() => void> = [];
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    for (const fn of listeners) {
      try { fn(); } catch { /* swallow */ }
    }
    try { raw.end(); } catch { /* already closed */ }
  };

  req.raw.on('close', close);
  req.raw.on('error', close);

  return {
    send(event, data) {
      if (closed) return;
      raw.write(`event: ${event}\n`);
      raw.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    close,
    onClose(fn) {
      listeners.push(fn);
    },
  };
}
