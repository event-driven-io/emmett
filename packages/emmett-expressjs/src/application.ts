import express, { Router, type Application } from 'express';
import 'express-async-errors';
import http from 'http';
import { problemDetailsMiddleware } from './middlewares/problemDetailsMiddleware';
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
};

export const getApplication = (options: ApplicationOptions) => {
  const app: Application = express();

  const {
    apis,
    mapError,
    enableDefaultExpressEtag,
    disableJsonMiddleware,
    disableUrlEncodingMiddleware,
    disableProblemDetailsMiddleware,
  } = options;

  const router = Router();

  // disabling default etag behaviour
  // to use etags in if-match and if-not-match headers
  app.set('etag', enableDefaultExpressEtag ?? false);

  // add json middleware
  if (!disableJsonMiddleware) app.use(express.json());

  // enable url encoded urls and bodies
  if (!disableUrlEncodingMiddleware)
    app.use(
      express.urlencoded({
        extended: true,
      }),
    );

  for (const api of apis) {
    api(router);
  }
  app.use(router);

  // add problem details middleware
  if (!disableProblemDetailsMiddleware)
    app.use(problemDetailsMiddleware(mapError));

  return app;
};

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
