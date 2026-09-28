import { portableApiPlugin } from '@event-driven-io/emmett-fastify';
import Fastify, { type FastifyRequest } from 'fastify';
import type { AddressInfo } from 'node:net';
import {
  ConformanceUserHeader,
  eventStoreHttpApiConformanceSuite,
  type ConformanceHostContext,
} from '../testing';

eventStoreHttpApiConformanceSuite({
  name: 'Fastify',
  start: async ({ api, mountPath, hostPrefix }) => {
    const app = Fastify({ logger: false });
    const users = new WeakMap<FastifyRequest, ConformanceHostContext['user']>();

    app.addHook('onRequest', (request, _reply, done) => {
      const role = request.headers[ConformanceUserHeader];
      if (role === 'viewer' || role === 'editor' || role === 'admin')
        users.set(request, { id: `user-${role}`, role });
      done();
    });
    app.get('/host/health', () => 'ok');

    await app.register(portableApiPlugin<ConformanceHostContext>, {
      api,
      mountPath,
      resolveContext: (request) => ({ user: users.get(request) }),
      ...(hostPrefix ? { prefix: hostPrefix } : {}),
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      close: async () => {
        app.server.closeAllConnections();
        await app.close();
      },
    };
  },
});
