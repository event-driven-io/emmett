import Compress from '@fastify/compress';
import Etag from '@fastify/etag';
import Form from '@fastify/formbody';
import {
  currentDefaultObservability,
  type Observability,
} from '@event-driven-io/emmett';
import closeWithGrace from 'close-with-grace';
import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyPluginCallback,
  type FastifyPluginOptions,
  type FastifyServerOptions,
} from 'fastify';
import { traceIdHook } from './traceIdHook';

export * from './traceIdHook';

// TODO: THIS WILL NEED TO BE BETTER TYPED
type Plugin = {
  plugin: FastifyPluginAsync | FastifyPluginCallback;
  options: FastifyPluginOptions;
};

const defaultPlugins: Plugin[] = [
  { plugin: Etag, options: {} },
  { plugin: Compress, options: { global: false } },
  { plugin: Form, options: {} },
];

export interface ApplicationOptions {
  serverOptions?: FastifyServerOptions;
  registerRoutes?: (app: FastifyInstance) => void;
  activeDefaultPlugins?: Plugin[];
  observability?: Partial<Observability<string>>;
  disableTraceIdHeader?: boolean;
}

export const getApplication = async (options: ApplicationOptions) => {
  const {
    registerRoutes,
    activeDefaultPlugins = defaultPlugins,
    serverOptions,
    observability,
    disableTraceIdHeader,
  } = options;

  const app: FastifyInstance = Fastify(serverOptions);

  const isObservabilityRegistered =
    observability !== undefined || currentDefaultObservability() !== undefined;

  if (isObservabilityRegistered && disableTraceIdHeader !== true)
    app.addHook('onRequest', traceIdHook);

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
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
