import { ExpectedVersionConflictError } from '@event-driven-io/emmett';
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
import { setETag, type ETag } from './etag';

export * from './etag';
export * from './handler';

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
    let problemDetails: ProblemDocument | undefined;

    if (mapError) problemDetails = mapError(error, request);

    problemDetails =
      problemDetails ?? defaulErrorToProblemDetailsMapping(error);

    sendProblem(response, problemDetails.status, { problem: problemDetails });
  };

export const defaulErrorToProblemDetailsMapping = (
  error: Error,
): ProblemDocument => {
  let statusCode = 500;

  if (error instanceof ExpectedVersionConflictError) {
    statusCode = 412;
  }

  return new ProblemDocument({
    detail: error.message,
    status: statusCode,
  });
};

export type HttpResponseOptions = {
  body?: unknown;
  location?: string;
  eTag?: ETag;
};

export type HttpProblemResponseOptions = {
  location?: string;
  eTag?: ETag;
} & Omit<HttpResponseOptions, 'body'> &
  (
    | {
        problem: ProblemDocument;
      }
    | { problemDetails: string }
  );

export type CreatedHttpResponseOptions = {
  createdId: string;
  urlPrefix?: string;
} & HttpResponseOptions;

export const sendCreated = (
  response: Response,
  { createdId, urlPrefix, eTag }: CreatedHttpResponseOptions,
): void =>
  send(response, 201, {
    location: `${urlPrefix ?? response.req.url}/${createdId}`,
    body: { id: createdId },
    eTag,
  });

export type AcceptedHttpResponseOptions = {
  location: string;
} & HttpResponseOptions;

export const sendAccepted = (
  response: Response,
  options: AcceptedHttpResponseOptions,
): void => send(response, 202, options);

export type NoContentHttpResponseOptions = Omit<HttpResponseOptions, 'body'>;

export const send = (
  response: Response,
  statusCode: number,
  { location, body, eTag }: HttpResponseOptions,
): void => {
  // HEADERS
  if (eTag) setETag(response, eTag);
  if (location) response.setHeader('Location', location);

  response.statusCode = statusCode;

  if (body) response.json(body);
};

export const sendProblem = (
  response: Response,
  statusCode: number,
  options: HttpProblemResponseOptions,
): void => {
  const { location, eTag } = options;

  const problemDetails =
    'problem' in options
      ? options.problem
      : new ProblemDocument({
          detail: options.problemDetails,
          status: statusCode,
        });

  // HEADERS
  if (eTag) setETag(response, eTag);
  if (location) response.setHeader('Location', location);

  response.setHeader('Content-Type', 'application/problem+json');

  response.statusCode = statusCode;
  response.json(problemDetails);
};
