import { portableApiRouter } from '@event-driven-io/emmett-expressjs';
import express, { type Request } from 'express';
import type { AddressInfo } from 'node:net';
import {
  ConformanceUserHeader,
  eventStoreHttpApiConformanceSuite,
  type ConformanceHostContext,
} from '../testing';

eventStoreHttpApiConformanceSuite({
  name: 'Express',
  start: async ({ api, mountPath, hostPrefix }) => {
    const app = express();
    const users = new WeakMap<Request, ConformanceHostContext['user']>();

    // Host-owned middleware inherited by Emmett routes
    app.use(express.json());
    app.use((request, _response, next) => {
      const role = request.get(ConformanceUserHeader);
      if (role === 'viewer' || role === 'editor' || role === 'admin')
        users.set(request, { id: `user-${role}`, role });
      next();
    });
    app.get('/host/health', (_request, response) => {
      response.send('ok');
    });

    const router = portableApiRouter(api, {
      mountPath,
      resolveContext: (request) => ({ user: users.get(request) }),
    });
    if (hostPrefix) app.use(hostPrefix, router);
    else app.use(router);

    const server = await new Promise<ReturnType<typeof app.listen>>(
      (resolve) => {
        const started = app.listen(0, '127.0.0.1', () => resolve(started));
      },
    );
    const { port } = server.address() as AddressInfo;

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    };
  },
});
