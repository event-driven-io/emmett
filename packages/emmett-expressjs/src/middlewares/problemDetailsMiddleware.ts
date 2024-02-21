import { EmmettError } from '@event-driven-io/emmett';
import type { NextFunction, Request, Response } from 'express';
import { ProblemDocument } from 'http-problem-details';
import { sendProblem, type ErrorToProblemDetailsMapping } from '..';

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

  if (error instanceof EmmettError) {
    statusCode = error.errorCode;
  }

  return new ProblemDocument({
    detail: error.message,
    status: statusCode,
  });
};
