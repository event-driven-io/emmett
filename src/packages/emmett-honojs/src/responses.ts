import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { ProblemDocument } from 'http-problem-details';
import { setETag, type ETag } from './etag';

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
  context: Context,
  { eTag, ...options }: CreatedHttpResponseOptions,
): Response => {
  return send(context, 201, {
    location:
      'url' in options
        ? options.url
        : `${context.req.url}/${options.createdId}`,
    body: 'createdId' in options ? { id: options.createdId } : undefined,
    eTag,
  });
};

export type AcceptedHttpResponseOptions = {
  location: string;
} & HttpResponseOptions;

export const sendAccepted = (
  context: Context,
  options: AcceptedHttpResponseOptions,
): Response => {
  return send(context, 202, options);
};

export type NoContentHttpResponseOptions = Omit<HttpResponseOptions, 'body'>;

export const send = (
  context: Context,
  statusCode: StatusCode,
  options?: HttpResponseOptions,
): Response => {
  const { location, body, eTag } = options ?? DefaultHttpResponseOptions;
  // HEADERS
  if (eTag) setETag(context, eTag);
  if (location) context.header('Location', location);

  context.status(statusCode);

  if (body) {
    return context.json(body);
  }
  return context.body(null);
};

export const sendProblem = (
  context: Context,
  statusCode: StatusCode,
  options?: HttpProblemResponseOptions,
): Response => {
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
  if (eTag) setETag(context, eTag);
  if (location) context.header('Location', location);

  context.header('Content-Type', 'application/problem+json');
  context.status(statusCode);

  return context.json(problemDetails);
};
