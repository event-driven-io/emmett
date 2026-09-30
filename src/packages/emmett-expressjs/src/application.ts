import type { Observability } from '@event-driven-io/almanac';
import {
  currentDefaultObservability,
  LogEvent,
  noopLogger,
} from '@event-driven-io/emmett';
import express, { Router, type Application } from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { problemDetailsMiddleware } from './middlewares/problemDetailsMiddleware';
import { traceIdMiddleware } from './middlewares/traceIdMiddleware';
import type { ErrorToProblemDetailsMapping } from './responses';

// #region web-api-setup
export type WebApiSetup = (router: Router) => void;
// #endregion web-api-setup

export type ApplicationOptions = {
  apis: WebApiSetup[];
  mapError?: ErrorToProblemDetailsMapping;
  enableDefaultExpressEtag?: boolean;
  disableJsonMiddleware?: boolean;
  disableUrlEncodingMiddleware?: boolean;
  disableProblemDetailsMiddleware?: boolean;
  observability?: Partial<Observability<string>>;
  disableTraceIdHeader?: boolean;
};

export const registerWebApi = (
  application: Application,
  apis: WebApiSetup[],
): Application => {
  const router = Router();

  for (const api of apis) {
    api(router);
  }
  application.use(router);

  return application;
};

export const configureApplication = (
  application: Application,
  options: ApplicationOptions,
): Application => {
  const {
    apis,
    mapError,
    enableDefaultExpressEtag,
    disableJsonMiddleware,
    disableUrlEncodingMiddleware,
    disableProblemDetailsMiddleware,
    observability,
    disableTraceIdHeader,
  } = options;

  // disabling default etag behaviour
  // to use etags in if-match and if-not-match headers
  application.set('etag', enableDefaultExpressEtag ?? false);

  // add json middleware
  if (!disableJsonMiddleware) application.use(express.json());

  // enable url encoded urls and bodies
  if (!disableUrlEncodingMiddleware)
    application.use(
      express.urlencoded({
        extended: true,
      }),
    );

  const isObservabilityRegistered =
    observability !== undefined || currentDefaultObservability() !== undefined;

  if (isObservabilityRegistered && disableTraceIdHeader !== true)
    application.use(traceIdMiddleware);

  registerWebApi(application, apis);

  // add problem details middleware
  if (!disableProblemDetailsMiddleware)
    application.use(problemDetailsMiddleware(mapError));

  return application;
};

export const getApplication = (options: ApplicationOptions): Application =>
  configureApplication(express(), options);

export type StartApiOptions = {
  port?: number;
  observability?: Partial<Observability<string>>;
};

export const startAPI = (app: Application, options: StartApiOptions = {}) => {
  const { port = 3000 } = options;
  const server = http.createServer(app);
  const log =
    options.observability?.logger ??
    currentDefaultObservability()?.logger ??
    noopLogger;

  server.on('listening', () => {
    const { port } = server.address() as AddressInfo;
    log(LogEvent.info({ 'server.port': port }, 'Server listening'));
  });

  return server.listen(port);
};
