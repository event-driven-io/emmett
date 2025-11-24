import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import {
  send,
  sendAccepted,
  sendCreated,
  sendProblem,
  type AcceptedHttpResponseOptions,
  type CreatedHttpResponseOptions,
  type HttpProblemResponseOptions,
  type HttpResponseOptions,
  type NoContentHttpResponseOptions,
} from '.';

// #region httpresponse-on
export type HttpResponse = (context: Context) => void;

export type HttpHandler = (
  context: Context,
) => Promise<HttpResponse> | HttpResponse;

// #endregion httpresponse-on

export const OK =
  (options?: HttpResponseOptions): HttpResponse =>
  (context: Context) => {
    send(context, 200, options);
  };

export const Created =
  (options: CreatedHttpResponseOptions): HttpResponse =>
  (context: Context) => {
    sendCreated(context, options);
  };

export const Accepted =
  (options: AcceptedHttpResponseOptions): HttpResponse =>
  (context: Context) => {
    sendAccepted(context, options);
  };

export const NoContent = (
  options?: NoContentHttpResponseOptions,
): HttpResponse => HttpResponse(204, options);

export const HttpResponse =
  (statusCode: StatusCode, options?: HttpResponseOptions): HttpResponse =>
  (context: Context) => {
    send(context, statusCode, options);
  };

/////////////////////
// ERRORS
/////////////////////

export const BadRequest = (
  options?: HttpProblemResponseOptions,
): HttpResponse => HttpProblem(400, options);

export const Forbidden = (options?: HttpProblemResponseOptions): HttpResponse =>
  HttpProblem(403, options);

export const NotFound = (options?: HttpProblemResponseOptions): HttpResponse =>
  HttpProblem(404, options);

export const Conflict = (options?: HttpProblemResponseOptions): HttpResponse =>
  HttpProblem(409, options);

export const PreconditionFailed = (
  options: HttpProblemResponseOptions,
): HttpResponse => HttpProblem(412, options);

export const HttpProblem =
  (
    statusCode: StatusCode,
    options?: HttpProblemResponseOptions,
  ): HttpResponse =>
  (context: Context) => {
    sendProblem(context, statusCode, options);
  };
