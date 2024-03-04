import { type NextFunction, type Request, type Response } from 'express';
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
export type HttpResponse = (response: Response) => void;

export type HttpHandler<RequestType extends Request> = (
  request: RequestType,
) => Promise<HttpResponse> | HttpResponse;

export const on =
  <RequestType extends Request>(handle: HttpHandler<RequestType>) =>
  async (
    request: RequestType,
    response: Response,
    _next: NextFunction,
  ): Promise<void> => {
    const setResponse = await Promise.resolve(handle(request));

    return setResponse(response);
  };
// #endregion httpresponse-on

export const OK =
  (options?: HttpResponseOptions): HttpResponse =>
  (response: Response) => {
    send(response, 200, options);
  };

export const Created =
  (options: CreatedHttpResponseOptions): HttpResponse =>
  (response: Response) => {
    sendCreated(response, options);
  };

export const Accepted =
  (options: AcceptedHttpResponseOptions): HttpResponse =>
  (response: Response) => {
    sendAccepted(response, options);
  };

export const NoContent = (
  options?: NoContentHttpResponseOptions,
): HttpResponse => HttpResponse(204, options);

export const HttpResponse =
  (statusCode: number, options?: HttpResponseOptions): HttpResponse =>
  (response: Response) => {
    send(response, statusCode, options);
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
  (statusCode: number, options?: HttpProblemResponseOptions): HttpResponse =>
  (response: Response) => {
    sendProblem(response, statusCode, options);
  };
