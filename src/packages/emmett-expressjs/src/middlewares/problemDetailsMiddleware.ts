import {
  defaultErrorToProblemDetailsMapping,
  type ProblemDocument,
} from '@event-driven-io/emmett';
import type { NextFunction, Request, Response } from 'express';
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

export { defaultErrorToProblemDetailsMapping } from '@event-driven-io/emmett';
