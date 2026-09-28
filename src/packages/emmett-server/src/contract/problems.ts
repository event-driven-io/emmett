import type { ProblemDetails } from '@event-driven-io/emmett';
import { EmmettDocumentationBaseUrl } from './relations';

export const ProblemCodes = {
  INVALID_REQUEST: { status: 400, title: 'Request is invalid' },
  INVALID_RANGE: { status: 400, title: 'Read range is invalid' },
  INVALID_CURSOR: { status: 400, title: 'Cursor is invalid' },
  INVALID_CONDITIONAL_HEADER: {
    status: 400,
    title: 'Conditional request header is invalid',
  },
  UNAUTHENTICATED: { status: 401, title: 'Authentication is required' },
  FORBIDDEN: { status: 403, title: 'Operation is not permitted' },
  STREAM_NOT_FOUND: { status: 404, title: 'Stream was not found' },
  NOT_ACCEPTABLE: {
    status: 406,
    title: 'Requested representation is not available',
  },
  EXPECTED_STREAM_VERSION_MISMATCH: {
    status: 412,
    title: 'Expected stream version did not match',
  },
  CONTENT_TOO_LARGE: { status: 413, title: 'Request content is too large' },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    title: 'Request media type is not supported',
  },
  NOT_IMPLEMENTED: {
    status: 501,
    title: 'Operation is not supported by the configured backend',
  },
  BACKEND_UNAVAILABLE: { status: 503, title: 'Backend is unavailable' },
  INTERNAL_ERROR: { status: 500, title: 'Internal server error' },
} as const;

export type ProblemCode = keyof typeof ProblemCodes;

export const problemTypeUri = (code: ProblemCode): string =>
  `${EmmettDocumentationBaseUrl}/problems/${code.toLowerCase().replaceAll('_', '-')}`;

export const eventStoreProblem = (
  code: ProblemCode,
  options?: { detail?: string; instance?: string; traceId?: string },
): ProblemDetails => {
  const { status, title } = ProblemCodes[code];

  return {
    type: problemTypeUri(code),
    title,
    status,
    ...(options?.detail !== undefined ? { detail: options.detail } : {}),
    ...(options?.instance !== undefined ? { instance: options.instance } : {}),
    code,
    ...(options?.traceId !== undefined ? { traceId: options.traceId } : {}),
  };
};
