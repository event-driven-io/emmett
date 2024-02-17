import express, {
  Router,
  type Application,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import 'express-async-errors';
import http from 'http';
import { ProblemDocument } from 'http-problem-details';

export type ErrorToProblemDetailsMapping = (
  error: Error,
  request: Request,
) => ProblemDocument | undefined;

export type ApplicationOptions = {
  apis: ((router: Router) => void)[];
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
  options: StartApiOptions = { port: 5000 },
) => {
  const { port } = options;
  const server = http.createServer(app);

  server.listen(port);

  server.on('listening', () => {
    console.info('server up listening');
  });
};

export const problemDetailsMiddleware =
  (mapError?: ErrorToProblemDetailsMapping) =>
  (
    error: Error,
    request: Request,
    response: Response,
    _next: NextFunction,
  ): void => {
    const statusCode = 500;

    let problemDetails: ProblemDocument | undefined;

    if (mapError) problemDetails = mapError(error, request);

    problemDetails =
      problemDetails ??
      new ProblemDocument({
        detail: error.message,
        status: statusCode,
      });

    response.statusCode = problemDetails.status;
    response.setHeader('Content-Type', 'application/problem+json');
    response.json(problemDetails);
  };

export const sendCreated = (
  response: Response,
  createdId: string,
  urlPrefix?: string,
): void =>
  sendWithLocationHeader(
    response,
    201,
    `${urlPrefix ?? response.req.url}/${createdId}`,
    { id: createdId },
  );

export const sendAccepted = (
  response: Response,
  url: string,
  body?: unknown,
): void => sendWithLocationHeader(response, 202, url, body);

export const sendWithLocationHeader = (
  response: Response,
  statusCode: number,
  url: string,
  body?: unknown,
): void => {
  response.setHeader('Location', url);
  response.status(statusCode);

  if (body) response.json(body);
};
