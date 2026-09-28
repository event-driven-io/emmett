import { EmmettError } from '../errors';

/**
 * RFC 9457 Problem Details document.
 *
 * `code` and `traceId` are extension members. Any other extension member can be
 * added through the index signature.
 */
export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  traceId?: string;
  [extension: string]: unknown;
};

export type HttpHeadersInit = ConstructorParameters<typeof Headers>[0];

export const ProblemDetailsContentType = 'application/problem+json';

export const problemDetailsResponse = (
  problem: ProblemDetails,
  options?: { headers?: HttpHeadersInit },
): Response => {
  const headers = new Headers(options?.headers);
  headers.set('content-type', ProblemDetailsContentType);

  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers,
  });
};

/**
 * Error carrying a complete Problem Details document, so code deep in a request
 * pipeline can stop processing with a precise HTTP outcome.
 */
export class ProblemDetailsError extends EmmettError {
  public problem: ProblemDetails;
  public headers: HttpHeadersInit | undefined;

  constructor(
    problem: ProblemDetails,
    options?: { headers?: HttpHeadersInit },
  ) {
    super({
      errorCode: problem.status,
      message: problem.detail ?? problem.title,
    });
    this.problem = problem;
    this.headers = options?.headers;

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, ProblemDetailsError.prototype);
  }
}

export const isProblemDetailsError = (
  error: unknown,
): error is ProblemDetailsError => error instanceof ProblemDetailsError;
