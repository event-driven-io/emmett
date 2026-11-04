import { emmettTypeId, hasTypeId } from '../typing/typeId';
import { isNumber, isString } from '../validation';

export const EmmettErrorTypeId = emmettTypeId('EmmettError');

export type ErrorConstructor<ErrorType extends Error> = new (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => ErrorType;

export const isErrorConstructor = <ErrorType extends Error>(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  expect: Function,
): expect is ErrorConstructor<ErrorType> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    typeof expect === 'function' &&
    expect.prototype &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect.prototype.constructor === expect
  );
};

export type EmmettErrorOptions = {
  status: number;
  message?: string;
  code?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
};

const defaultCodes: Record<number, string> = {
  400: 'EMT_ERR_VALIDATION',
  403: 'EMT_ERR_ILLEGAL_STATE',
  404: 'EMT_ERR_NOT_FOUND',
  412: 'EMT_ERR_CONCURRENCY',
};

export class EmmettError extends Error {
  public static readonly Codes = {
    ValidationError: 400,
    IllegalStateError: 403,
    NotFoundError: 404,
    ConcurrencyError: 412,
    InternalServerError: 500,
  };

  public status: number;
  public code: string;
  public details?: Record<string, unknown>;

  /**
   * @deprecated Use `status` instead.
   */
  public errorCode: number;

  constructor(
    options?:
      | EmmettErrorOptions
      | { errorCode: number; message?: string }
      | string
      | number,
  ) {
    const status =
      options && typeof options === 'object'
        ? 'status' in options
          ? options.status
          : options.errorCode
        : isNumber(options)
          ? options
          : EmmettError.Codes.InternalServerError;
    const message =
      options && typeof options === 'object' && 'message' in options
        ? options.message
        : isString(options)
          ? options
          : `Error with status code '${status}' ocurred during Emmett processing`;
    const { code, cause, details }: Partial<EmmettErrorOptions> =
      options && typeof options === 'object' && 'status' in options
        ? options
        : {};

    super(message, { cause });
    this.status = status;
    this.errorCode = status;
    this.code = code ?? defaultCodes[status] ?? 'EMT_ERR_INTERNAL';
    this.details = details;
    Object.defineProperty(this, EmmettErrorTypeId, { value: true });

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, EmmettError.prototype);
  }

  public static mapFrom(
    error: Error | (Partial<EmmettErrorOptions> & { errorCode?: number }),
  ): EmmettError {
    if (hasTypeId(error, EmmettErrorTypeId)) {
      return error as EmmettError;
    }

    const mapped = new EmmettError({
      status: statusOf(error) ?? EmmettError.Codes.InternalServerError,
      message: error.message ?? 'An unknown error occurred',
      code: 'code' in error && isString(error.code) ? error.code : undefined,
      cause: 'cause' in error ? error.cause : undefined,
      details:
        'details' in error &&
        typeof error.details === 'object' &&
        error.details !== null
          ? error.details
          : undefined,
    });

    if ('stack' in error && isString(error.stack)) {
      mapped.stack = error.stack;
    }

    return mapped;
  }

  public static isInstanceOf<ErrorType extends EmmettError = EmmettError>(
    error: unknown,
    status?: (typeof EmmettError.Codes)[keyof typeof EmmettError.Codes],
  ): error is ErrorType {
    const errorStatus = statusOf(error);

    return (
      errorStatus !== undefined &&
      (status === undefined || errorStatus === status)
    );
  }
}

const statusOf = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;

  if ('status' in error && isNumber(error.status)) return error.status;

  if ('errorCode' in error && isNumber(error.errorCode)) return error.errorCode;

  return undefined;
};

export class ConcurrencyError extends EmmettError {
  constructor(
    public current: string | undefined,
    public expected: string,
    options?: string | Omit<EmmettErrorOptions, 'status'>,
  ) {
    const { message, ...rest } = isString(options)
      ? { message: options }
      : (options ?? {});
    super({
      ...rest,
      status: EmmettError.Codes.ConcurrencyError,
      message:
        message ??
        `Expected version ${expected.toString()} does not match current ${current?.toString()}`,
    });

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, ConcurrencyError.prototype);
  }
}

// TODO: Make it derive from ConcurrencyError to avoid code duplication
// Or add additional type to distinguinsh both errors
export class ConcurrencyInMemoryDatabaseError extends EmmettError {
  constructor(options?: string | Omit<EmmettErrorOptions, 'status'>) {
    const { message, ...rest } = isString(options)
      ? { message: options }
      : (options ?? {});
    super({
      ...rest,
      code: rest.code ?? 'EMT_ERR_IN_MEMORY_DATABASE_CONCURRENCY',
      status: EmmettError.Codes.ConcurrencyError,
      message: message ?? `Expected document state does not match current one!`,
    });

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, ConcurrencyInMemoryDatabaseError.prototype);
  }
}

export class ValidationError extends EmmettError {
  constructor(options?: string | Omit<EmmettErrorOptions, 'status'>) {
    const { message, ...rest } = isString(options)
      ? { message: options }
      : (options ?? {});
    super({
      ...rest,
      status: EmmettError.Codes.ValidationError,
      message: message ?? `Validation Error ocurred during Emmett processing`,
    });

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class IllegalStateError extends EmmettError {
  constructor(options?: string | Omit<EmmettErrorOptions, 'status'>) {
    const { message, ...rest } = isString(options)
      ? { message: options }
      : (options ?? {});
    super({
      ...rest,
      status: EmmettError.Codes.IllegalStateError,
      message: message ?? `Illegal State ocurred during Emmett processing`,
    });

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, IllegalStateError.prototype);
  }
}

export class NotFoundError extends EmmettError {
  constructor(
    options?: {
      id: string;
      type: string;
    } & Omit<EmmettErrorOptions, 'status'>,
  ) {
    super({
      code: options?.code,
      cause: options?.cause,
      details: options?.details,
      status: EmmettError.Codes.NotFoundError,
      message:
        options?.message ??
        (options?.id
          ? options.type
            ? `${options.type} with ${options.id} was not found during Emmett processing`
            : `State with ${options.id} was not found during Emmett processing`
          : options?.type
            ? `${options.type} was not found during Emmett processing`
            : 'State was not found during Emmett processing'),
    });

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}
