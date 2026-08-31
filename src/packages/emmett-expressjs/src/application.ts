import type { Observability } from '@event-driven-io/almanac';
import express, { Router, type Application } from 'express';
import http from 'http';
import { problemDetailsMiddleware } from './middlewares/problemDetailsMiddleware';
import { traceIdMiddleware } from './middlewares/traceIdMiddleware';
import type { ErrorToProblemDetailsMapping } from './responses';

// #region web-api-setup
export type WebApiSetup = (router: Router) => void;
// #endregion web-api-setup

export type ApplicationOptions = {
  apis: WebApiSetup[];
  mapError?: ErrorToProblemDetailsMapping;
  disableJsonMiddleware?: boolean;
  disableUrlEncodingMiddleware?: boolean;
  disableProblemDetailsMiddleware?: boolean;
  observability?: Partial<Observability<string>>;
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
    disableJsonMiddleware,
    disableUrlEncodingMiddleware,
    disableProblemDetailsMiddleware,
    observability,
  } = options;

  // add json middleware
  if (!disableJsonMiddleware) application.use(express.json());

  // enable url encoded urls and bodies
  if (!disableUrlEncodingMiddleware)
    application.use(
      express.urlencoded({
        extended: true,
      }),
    );

  if (observability) application.use(traceIdMiddleware);

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
};

export const startAPI = (
  app: Application,
  options: StartApiOptions = { port: 3000 },
) => {
  const { port } = options;
  const server = http.createServer(app);

  server.on('listening', () => {
    console.info('server up listening');
  });

  return server.listen(port);
};
