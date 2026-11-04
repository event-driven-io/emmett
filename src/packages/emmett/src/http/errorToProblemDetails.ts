import { isNumber } from '../validation';
import { ProblemDocument } from './problemDocument';

const statusOf = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;

  if ('status' in error && isNumber(error.status)) return error.status;
  if ('statusCode' in error && isNumber(error.statusCode))
    return error.statusCode;
  if ('errorCode' in error && isNumber(error.errorCode)) return error.errorCode;

  return undefined;
};

export const defaultErrorToProblemDetailsMapping = (
  error: unknown,
): ProblemDocument => {
  const status = statusOf(error);

  const detail =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Internal Server Error';

  return new ProblemDocument({
    detail,
    status:
      status !== undefined && status >= 100 && status < 600 ? status : 500,
  });
};
