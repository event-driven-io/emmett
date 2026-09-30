import {
  assertDeepEqual,
  assertEqual,
  setupEmmettObservability,
} from '@event-driven-io/emmett';
import { trace, type Span } from '@opentelemetry/api';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { afterEach, describe, it, vi } from 'vitest';
import { getApplication, startAPI, traceIdHook } from '.';

const registerTraceRoute = (app: FastifyInstance) =>
  app.get('/trace', (_request, reply) => reply.code(204).send());

const spyOnOutput = () => {
  const spies = [
    ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method),
    ),
    vi.spyOn(process.stdout, 'write'),
    vi.spyOn(process.stderr, 'write'),
  ];

  return {
    callCounts: () => spies.map((spy) => spy.mock.calls.length),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
};

void describe('Fastify logger', () => {
  void it('the Fastify logger is off by default', async () => {
    const output = spyOnOutput();
    const app = await getApplication({ registerRoutes: registerTraceRoute });

    try {
      await startAPI(app, { port: 0 });
      await app.inject({ method: 'GET', url: '/trace' });

      assertDeepEqual(output.callCounts(), [0, 0, 0, 0, 0, 0, 0]);
    } finally {
      output.restore();
      await app.close();
    }
  });

  void it("a loggerInstance passed in serverOptions receives Fastify's logs", async () => {
    const messages: string[] = [];
    const log =
      () =>
      (...args: unknown[]) =>
        messages.push(
          args.find((arg): arg is string => typeof arg === 'string') ?? '',
        );
    const loggerInstance: FastifyBaseLogger = {
      level: 'info',
      fatal: log(),
      error: log(),
      warn: log(),
      info: log(),
      debug: log(),
      trace: log(),
      silent: log(),
      child: () => loggerInstance,
    };
    const app = await getApplication({
      serverOptions: { loggerInstance },
      registerRoutes: registerTraceRoute,
    });

    try {
      await app.inject({ method: 'GET', url: '/trace' });

      assertDeepEqual(messages, ['incoming request', 'request completed']);
    } finally {
      await app.close();
    }
  });

  void it('startAPI writes nothing to the console when the logger is off', async () => {
    const output = spyOnOutput();
    const app = await getApplication({ serverOptions: { logger: false } });

    try {
      await startAPI(app, { port: 0 });

      assertDeepEqual(output.callCounts(), [0, 0, 0, 0, 0, 0, 0]);
    } finally {
      output.restore();
      await app.close();
    }
  });
});

void describe('observability', () => {
  const traceId = '0123456789abcdef0123456789abcdef';

  const withActiveSpan = async <T>(fn: () => Promise<T>): Promise<T> => {
    const getSpan = vi.spyOn(trace, 'getSpan').mockReturnValue({
      spanContext: () => ({
        traceId,
        spanId: '0123456789abcdef',
        traceFlags: 1,
      }),
    } as Span);
    try {
      return await fn();
    } finally {
      getSpan.mockRestore();
    }
  };

  const traceIdHeaderFrom = async (
    options: Parameters<typeof getApplication>[0],
  ) => {
    const app = await getApplication({
      ...options,
      registerRoutes: registerTraceRoute,
    });
    try {
      const response = await withActiveSpan(() =>
        app.inject({ method: 'GET', url: '/trace' }),
      );
      return response.headers['x-trace-id'];
    } finally {
      await app.close();
    }
  };

  afterEach(() => setupEmmettObservability(undefined));

  void it('adds x-trace-id when observability is registered globally', async () => {
    setupEmmettObservability({});

    assertEqual(await traceIdHeaderFrom({}), traceId);
  });

  void it('adds x-trace-id when observability is passed to the application', async () => {
    assertEqual(await traceIdHeaderFrom({ observability: {} }), traceId);
  });

  void it('does not add x-trace-id when disableTraceIdHeader is true', async () => {
    setupEmmettObservability({});

    assertEqual(
      await traceIdHeaderFrom({
        observability: {},
        disableTraceIdHeader: true,
      }),
      undefined,
    );
  });

  void it('traceIdHook adds x-trace-id to an application set up by the caller', async () => {
    const app = Fastify();
    app.addHook('onRequest', traceIdHook);
    registerTraceRoute(app);

    try {
      const response = await withActiveSpan(() =>
        app.inject({ method: 'GET', url: '/trace' }),
      );

      assertEqual(response.headers['x-trace-id'], traceId);
    } finally {
      await app.close();
    }
  });

  void it('does not add x-trace-id when no observability is registered', async () => {
    assertEqual(await traceIdHeaderFrom({}), undefined);
  });
});
