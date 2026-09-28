import { registerPortableApi } from '@event-driven-io/emmett-honojs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { AddressInfo } from 'node:net';
import {
  ConformanceUserHeader,
  eventStoreHttpApiConformanceSuite,
  type ConformanceHostContext,
} from '../testing';

type HostEnv = { Variables: { user: ConformanceHostContext['user'] } };

eventStoreHttpApiConformanceSuite({
  name: 'Hono',
  start: async ({ api, mountPath, hostPrefix }) => {
    const app = new Hono<HostEnv>();

    app.use('*', async (context, next) => {
      const role = context.req.header(ConformanceUserHeader);
      if (role === 'viewer' || role === 'editor' || role === 'admin')
        context.set('user', { id: `user-${role}`, role });
      await next();
    });
    app.get('/host/health', (context) => context.text('ok'));

    const emmett = new Hono<HostEnv>();
    registerPortableApi(emmett, api, {
      mountPath,
      resolveContext: (context) => ({ user: context.get('user') }),
    });
    app.route(hostPrefix ?? '/', emmett);

    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const started = serve(
        { fetch: app.fetch, port: 0, hostname: '127.0.0.1' },
        () => resolve(started),
      );
    });
    const { port } = server.address() as AddressInfo;

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    };
  },
});
