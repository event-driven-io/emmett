import { isNumber } from '@event-driven-io/emmett';
import { ProblemDocument } from 'http-problem-details';

export const defaultErrorToProblemDetailsMapping = (
  error: Error,
): ProblemDocument => {
  let statusCode = 500;

  const status =
    'status' in error && isNumber(error.status)
      ? error.status
      : 'errorCode' in error && isNumber(error.errorCode)
        ? error.errorCode
        : undefined;

  if (status !== undefined && status >= 100 && status < 600) {
    statusCode = status;
  }

  return new ProblemDocument({
    detail: error.message,
    status: statusCode,
  });
};
