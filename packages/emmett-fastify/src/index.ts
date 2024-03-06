import Compress, { type FastifyCompressOptions } from '@fastify/compress';
import Etag, { type FastifyEtagOptions } from '@fastify/etag';
import Form, { type FastifyFormbodyOptions } from '@fastify/formbody';
import closeWithGrace from 'close-with-grace';
import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyPluginCallback,
  type FastifyPluginOptions,
} from 'fastify';

// TODO: THIS WILL NEED TO BE BETTER TYPED
type Plugin = {
  plugin: FastifyPluginAsync | FastifyPluginCallback;
  options: FastifyPluginOptions;
};

const defaultPlugins: Plugin[] = [
  { plugin: Etag, options: {} as FastifyEtagOptions },
  { plugin: Compress, options: { global: false } as FastifyCompressOptions },
  { plugin: Form, options: {} as FastifyFormbodyOptions },
];

export interface ApplicationOptions {
  serverOptions?: { logger: boolean };
  registerRoutes?: (app: FastifyInstance) => void;
  activeDefaultPlugins?: Plugin[];
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
