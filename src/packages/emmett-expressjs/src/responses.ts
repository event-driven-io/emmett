import { type Request, type Response } from 'express';
import { ProblemDocument } from 'http-problem-details';
import { setETag, type ETag } from './etag';

export type ErrorToProblemDetailsMapping = (
  error: Error,
  request: Request,
) => ProblemDocument | undefined;

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

export type CreatedHttpResponseOptions = (
  | {
      createdId: string;
    }
  | {
      createdId?: string;
      url: string;
    }
) &
  HttpResponseOptions;

export const sendCreated = (
  response: Response,
  { eTag, ...options }: CreatedHttpResponseOptions,
): void =>
  send(response, 201, {
    location:
      'url' in options
        ? options.url
        : `${response.req.url}/${options.createdId}`,
    body: 'createdId' in options ? { id: options.createdId } : undefined,
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
