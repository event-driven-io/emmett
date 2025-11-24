import { isNumber } from '@event-driven-io/emmett';
import { ProblemDocument } from 'http-problem-details';

export const defaultErrorToProblemDetailsMapping = (
  error: Error,
): ProblemDocument => {
  let statusCode = 500;

  if (
    'errorCode' in error &&
    isNumber(error.errorCode) &&
    error.errorCode >= 100 &&
    error.errorCode < 600
  ) {
    statusCode = error.errorCode;
  }

  return new ProblemDocument({
    detail: error.message,
    status: statusCode,
  });
};
