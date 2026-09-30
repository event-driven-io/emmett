import {
  currentDefaultObservability,
  LogEvent,
  noopLogger,
  type Observability,
} from '@event-driven-io/emmett';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { etag } from 'hono/etag';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ProblemDocument } from 'http-problem-details';
import { defaultErrorToProblemDetailsMapping } from './middlewares/problemDetailsMiddleware';
import { traceIdMiddleware } from './middlewares/traceIdMiddleware';

export type ErrorToProblemDetailsMapping = (
  error: Error,
) => ProblemDocument | undefined;

export type WebApiSetup = (router: Hono) => void;

export type ApplicationOptions = {
  apis: WebApiSetup[];
  mapError?: ErrorToProblemDetailsMapping;
  disableProblemDetailsMiddleware?: boolean;
  observability?: Partial<Observability<string>>;
  disableTraceIdHeader?: boolean;
};

export const registerWebApi = (
  application: Hono,
  apis: WebApiSetup[],
): Hono => {
  const router = new Hono();

  for (const api of apis) {
    api(router);
  }
  application.route('/', router);

  return application;
};

export const configureApplication = (
  application: Hono,
  options: ApplicationOptions,
): Hono => {
  const {
    apis,
    mapError,
    disableProblemDetailsMiddleware,
    observability,
    disableTraceIdHeader,
  } = options;

  application.use(etag());

  const isObservabilityRegistered =
    observability !== undefined || currentDefaultObservability() !== undefined;

  if (isObservabilityRegistered && disableTraceIdHeader !== true)
    application.use(traceIdMiddleware);

  registerWebApi(application, apis);

  // add problem details middleware
  if (!disableProblemDetailsMiddleware) {
    application.onError((error, c) => {
      // Replace with different mechanism as each app instance can only have defined one onError handler
      const problemDetails =
        mapError?.(error) ?? defaultErrorToProblemDetailsMapping(error);
      const response = c.json(
        problemDetails,
        problemDetails?.status as ContentfulStatusCode,
      );
      response.headers.set('Content-Type', 'application/problem+json');
      return response;
    });
  }

  return application;
};

export type StartApiOptions = {
  port?: number;
  observability?: Partial<Observability<string>>;
};

export const getApplication = (options: ApplicationOptions): Hono =>
  configureApplication(new Hono(), options);

export const startAPI = (
  app: Hono,
  options: StartApiOptions = { port: 3000 },
) => {
  const { port } = options;
  const log =
    options.observability?.logger ??
    currentDefaultObservability()?.logger ??
    noopLogger;

  return serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) =>
      log(LogEvent.info({ 'server.port': info.port }, 'Server listening')),
  );
};
