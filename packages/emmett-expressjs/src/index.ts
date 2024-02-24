import express, {
  Router,
  type Application,
  type Request,
  type Response,
} from 'express';
import 'express-async-errors';
import http from 'http';
import { ProblemDocument } from 'http-problem-details';
import { setETag, type ETag } from './etag';
import { problemDetailsMiddleware } from './middlewares/problemDetailsMiddleware';

export * from './etag';
export * from './handler';
export * from './testing';

export type ErrorToProblemDetailsMapping = (
  error: Error,
  request: Request,
) => ProblemDocument | undefined;

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

export type HttpResponseOptions = {
  body?: unknown;
  location?: string;
  eTag?: ETag;
};
export const DefaultHttpResponseOptions: HttpResponseOptions = {};

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
export const DefaultHttpProblemResponseOptions: HttpProblemResponseOptions = {
  problemDetails: 'Error occured!',
};

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
    // TODO: https://github.com/event-driven-io/emmett/issues/18
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
  options?: HttpResponseOptions,
): void => {
  // TODO: https://github.com/event-driven-io/emmett/issues/18
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { location, body, eTag } = options ?? DefaultHttpResponseOptions;
  // HEADERS
  if (eTag) setETag(response, eTag);
  if (location) response.setHeader('Location', location);

  if (body) {
    response.statusCode = statusCode;
    response.send(body);
  } else {
    response.sendStatus(statusCode);
  }
};

export const sendProblem = (
  response: Response,
  statusCode: number,
  options?: HttpProblemResponseOptions,
): void => {
  options = options ?? DefaultHttpProblemResponseOptions;

  // TODO: https://github.com/event-driven-io/emmett/issues/18
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
