// Interactive terminal — bridges a WebSocket to `docker exec -it <container> sh`.
// Client → `{"type":"stdin","data":"…"}` or `{"type":"resize","cols":80,"rows":24}`.
// Server → binary frames of stdout/stderr from the container.

import type { FastifyInstance } from 'fastify';
import type { DockerClient } from '../lib/docker.js';
import type { WebSocket } from '@fastify/websocket';

interface Deps {
  docker: DockerClient;
}

export async function terminalRoutes(fastify: FastifyInstance, { docker }: Deps) {
  fastify.get<{ Params: { id: string } }>(
    '/services/:id/terminal',
    { websocket: true },
    async (socket: WebSocket, req) => {
      const serviceId = req.params.id;

      const services = await docker.listServices().catch(() => []);
      const svc = services.find((s) => s.id === serviceId);
      if (!svc || !svc.container) {
        socket.send(JSON.stringify({ type: 'error', message: 'service not found' }));
        socket.close();
        return;
      }

      const container = docker.raw.getContainer(svc.container);
      let exec;
      try {
        exec = await container.exec({
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: true,
          // Prefer bash if available, fall back to sh. -l makes it a login shell so
          // PATH / aliases resolve the way the user expects.
          Cmd: ['/bin/sh', '-lc', 'command -v bash >/dev/null && exec bash -l || exec sh -l'],
        });
      } catch (err) {
        socket.send(JSON.stringify({ type: 'error', message: `exec create failed: ${(err as Error).message}` }));
        socket.close();
        return;
      }

      const stream = await exec.start({ hijack: true, stdin: true, Tty: true });

      // Docker → client
      stream.on('data', (chunk: Buffer) => {
        if (socket.readyState === socket.OPEN) socket.send(chunk);
      });
      stream.on('end', () => socket.close());
      stream.on('error', (err: Error) => {
        req.log.warn({ err, serviceId }, 'terminal stream error');
        socket.close();
      });

      // Client → Docker
      socket.on('message', (raw: Buffer | string) => {
        // Text frames are control messages (JSON); binary frames are raw stdin.
        if (typeof raw === 'string' || (raw instanceof Buffer && raw.length > 0 && raw[0] === 0x7b /* '{' */)) {
          try {
            const msg = JSON.parse(raw.toString('utf8')) as
              | { type: 'stdin'; data: string }
              | { type: 'resize'; cols: number; rows: number };
            if (msg.type === 'stdin') stream.write(msg.data);
            else if (msg.type === 'resize')
              exec.resize({ w: msg.cols, h: msg.rows }).catch(() => { /* best-effort */ });
            return;
          } catch {
            // fall through — treat as raw bytes
          }
        }
        stream.write(raw);
      });

      socket.on('close', () => {
        try { stream.end(); } catch { /* ignore */ }
      });
    },
  );
}
