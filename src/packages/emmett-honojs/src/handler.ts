import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import {
  type AcceptedHttpResponseOptions,
  type CreatedHttpResponseOptions,
  type HttpProblemResponseOptions,
  type HttpResponseOptions,
  type NoContentHttpResponseOptions,
  send,
  sendAccepted,
  sendCreated,
  sendProblem,
} from '.';

export type ContextWithBody<T> = Omit<Context, 'req'> & {
  req: Omit<Context['req'], 'json'> & {
    json(): Promise<T>;
  };
};

export type ContextWithQuery<T> = Omit<Context, 'req'> & {
  req: Omit<Context['req'], 'query'> & {
    query(): T;
  };
};

export type ContextWithParams<T> = Omit<Context, 'req'> & {
  req: Omit<Context['req'], 'param'> & {
    param<K extends keyof T>(key: K): T[K];
  };
};

export const OK = (
  options: HttpResponseOptions & { context: Context },
): Response => {
  const { context, ...responseOptions } = options;
  return send(context, 200, responseOptions);
};

export const Created = (
  options: CreatedHttpResponseOptions & { context: Context },
): Response => {
  const { context, ...responseOptions } = options;
  return sendCreated(context, responseOptions);
};

export const Accepted = (
  options: AcceptedHttpResponseOptions & { context: Context },
): Response => {
  const { context, ...responseOptions } = options;
  return sendAccepted(context, responseOptions);
};

export const NoContent = (
  options: NoContentHttpResponseOptions & { context: Context },
): Response => {
  const { context, ...responseOptions } = options;
  return send(context, 204, responseOptions);
};

export const HttpResponse = (
  options: HttpResponseOptions & { context: Context; statusCode: StatusCode },
): Response => {
  const { context, statusCode, ...responseOptions } = options;
  return send(context, statusCode, responseOptions);
};

/////////////////////
// ERRORS
/////////////////////

export const BadRequest = (
  options: HttpProblemResponseOptions & { context: Context },
): Response => {
  const { context, ...responseOptions } = options;
  return sendProblem(context, 400, responseOptions);
};

export const Forbidden = (
  options: HttpProblemResponseOptions & { context: Context },
): Response => {
  const { context, ...responseOptions } = options;
  return sendProblem(context, 403, responseOptions);
};

export const NotFound = (
  options: HttpProblemResponseOptions & { context: Context },
): Response => {
  const { context, ...responseOptions } = options;
  return sendProblem(context, 404, responseOptions);
};

export const Conflict = (
  options: HttpProblemResponseOptions & { context: Context },
): Response => {
  const { context, ...responseOptions } = options;
  return sendProblem(context, 409, responseOptions);
};

export const PreconditionFailed = (
  options: HttpProblemResponseOptions & { context: Context },
): Response => {
  const { context, ...responseOptions } = options;
  return sendProblem(context, 412, responseOptions);
};

export const HttpProblem = (
  options: HttpProblemResponseOptions & {
    context: Context;
    statusCode: StatusCode;
  },
): Response => {
  const { context, statusCode, ...responseOptions } = options;
  return sendProblem(context, statusCode, responseOptions);
};
