import { isNumber } from '@event-driven-io/emmett';
import type { NextFunction, Request, Response } from 'express';
import { ProblemDocument } from 'http-problem-details';
import { sendProblem, type ErrorToProblemDetailsMapping } from '..';

export const problemDetailsMiddleware =
  (mapError?: ErrorToProblemDetailsMapping) =>
  (
    error: unknown,
    request: Request,
    response: Response,
    _next: NextFunction,
  ): void => {
    let problemDetails: ProblemDocument | undefined;

    if (mapError) problemDetails = mapError(error, request);

    problemDetails =
      problemDetails ?? defaultErrorToProblemDetailsMapping(error);

    sendProblem(response, problemDetails.status, { problem: problemDetails });
  };

export const defaultErrorToProblemDetailsMapping = (
  error: unknown,
): ProblemDocument => {
  let statusCode = 500;
  let detail = 'Internal Server Error';

  if (
    typeof error === 'object' &&
    error !== null &&
    'errorCode' in error &&
    isNumber(error.errorCode) &&
    error.errorCode >= 100 &&
    error.errorCode < 600
  ) {
    statusCode = error.errorCode;
  }

  if (error instanceof Error) detail = error.message;
  else if (typeof error === 'string') detail = error;

  return new ProblemDocument({
    detail,
    status: statusCode,
  });
};
