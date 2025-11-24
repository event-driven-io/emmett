import { serve } from '@hono/node-server/.';
import { Hono } from 'hono';
import { etag } from 'hono/etag';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ProblemDocument } from 'http-problem-details';
import { defaultErrorToProblemDetailsMapping } from './middlewares/problemDetailsMiddleware';

export type ErrorToProblemDetailsMapping = (
  error: Error,
) => ProblemDocument | undefined;

export type WebApiSetup = (router: Hono) => void;

export type ApplicationOptions = {
  apis: WebApiSetup[];
  mapError?: ErrorToProblemDetailsMapping;
  disableProblemDetailsMiddleware?: boolean;
};

export type StartApiOptions = {
  port?: number;
};

export const getApplication = (options: ApplicationOptions) => {
  const app: Hono = new Hono();

  const { apis, mapError, disableProblemDetailsMiddleware } = options;

  const router = new Hono();

  app.use(etag());

  for (const api of apis) {
    api(router);
  }
  app.route('/', router);

  // add problem details middleware
  if (!disableProblemDetailsMiddleware) {
    const errorMapper = mapError ?? defaultErrorToProblemDetailsMapping;
    app.onError((error, c) => {
      // Replace with different mechanism as each app instance can only have defined one onError handler
      const problemDetails = errorMapper(error);
      return c.json(
        problemDetails,
        problemDetails?.status as ContentfulStatusCode,
      );
    });
  }

  return app;
};

export const startAPI = (
  app: Hono,
  options: StartApiOptions = { port: 3000 },
) => {
  const { port } = options;
  return serve({
    fetch: app.fetch,
    port,
  });
};
