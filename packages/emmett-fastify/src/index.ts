import Compress from '@fastify/compress';
import Etag from '@fastify/etag';
import Form from '@fastify/formbody';
import closeWithGrace from 'close-with-grace';
import Fastify, {
  type FastifyInstance,
} from 'fastify';

const defaultPlugins = [
  { plugin: Etag, options: {} },
  { plugin: Compress, options: { global: false } },
  { plugin: Form, options: {} },
];

export interface ApplicationOptions {
  serverOptions?: { logger: boolean };
  registerRoutes?: (app: FastifyInstance) => void;
  activeDefaultPlugins?: Array<{
    plugin: unknown;
    options: Record<string, unknown>;
  }>;
}

export const getApplication = async (options: ApplicationOptions) => {
  const {
    registerRoutes,
    activeDefaultPlugins = defaultPlugins,
    serverOptions = {
      logger: true,
    },
  } = options;

  const app: FastifyInstance = Fastify(serverOptions);

  await Promise.all(
    activeDefaultPlugins.map(async ({ plugin, options }) => {
      await app.register(plugin, options);
    }),
  );

  if (registerRoutes) {
    registerRoutes(app);
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
