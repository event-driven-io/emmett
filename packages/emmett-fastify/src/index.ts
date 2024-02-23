import Compress from '@fastify/compress';
import Etag from '@fastify/etag';
import Form from '@fastify/formbody';
import closeWithGrace from 'close-with-grace';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

const defaultPlugins = [
  { plugin: Etag, options: {} },
  { plugin: Compress, options: { global: false } },
  { plugin: Form, options: {} },
];


const defaultPostMiddlewares = (app: FastifyInstance) => {
  app.all('*', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(404).send();
  });
};

export interface ApplicationOptions {
  serverOptions?: { logger: boolean };
  registerRoutes?: (app: FastifyInstance) => void;
  registerPreMiddlewares?: (app: FastifyInstance) => void;
  registerPostMiddlewares?: (app: FastifyInstance) => void;
  extendApp?: (app: FastifyInstance) => FastifyInstance;
  activeDefaultPlugins?: Array<{
    plugin: unknown;
    options: Record<string, unknown>;
  }>;
}

export const getApplication = async (options: ApplicationOptions) => {
  const {
    registerPreMiddlewares,
    registerRoutes,
    registerPostMiddlewares = defaultPostMiddlewares,
    extendApp = (app) => app,
    activeDefaultPlugins = defaultPlugins,
    serverOptions = {
      logger: true,
    },
  } = options;

  const app: FastifyInstance = extendApp(
    Fastify({
      logger: serverOptions.logger,
    }),
  );

  await Promise.all(
    activeDefaultPlugins.map(async ({ plugin, options }) => {
      await app.register(plugin, options);
    }),
  );

  if (registerPreMiddlewares) {
    registerPreMiddlewares(app);
  }

  if (registerRoutes) {
    registerRoutes(app);
  }

  if (registerPostMiddlewares) {
    registerPostMiddlewares(app);
  }

  const closeListeners = closeWithGrace({ delay: 500 }, async (opts) => {
    if (opts.err) {
      app.log.error(opts.err);
    }

    await app.close();
  });

  app.addHook('onClose', (instance, done) => {
    closeListeners.uninstall();
    done();
  });

  return app;
};

export type StartApiOptions = {
  port?: number;
};

export const startAPI = async (
  app: FastifyInstance,
  options: StartApiOptions = { port: 5000 },
) => {
  const { port } = options;
  try {
    await app.listen({ port });
    const address = app.server.address() as { address: string; port: number };

    console.log(`Server listening on ${address?.address}:${address?.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
