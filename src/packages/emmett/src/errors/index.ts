import { isNumber, isString } from '../validation';

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

export class EmmettError extends Error {
  public static readonly Codes = {
    ValidationError: 400,
    IllegalStateError: 403,
    NotFoundError: 404,
    ConcurrencyError: 412,
    InternalServerError: 500,
  };

  public errorCode: number;

  constructor(
    options?: { errorCode: number; message?: string } | string | number,
  ) {
    const errorCode =
      options && typeof options === 'object' && 'errorCode' in options
        ? options.errorCode
        : isNumber(options)
          ? options
          : EmmettError.Codes.InternalServerError;
    const message =
      options && typeof options === 'object' && 'message' in options
        ? options.message
        : isString(options)
          ? options
          : `Error with status code '${errorCode}' ocurred during Emmett processing`;

    super(message);
    this.errorCode = errorCode;

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, EmmettError.prototype);
  }

  public static mapFrom(
    error: Error | { message?: string; errorCode?: number },
  ): EmmettError {
    if (EmmettError.isInstanceOf(error)) {
      return error;
    }

    return new EmmettError({
      errorCode:
        'errorCode' in error &&
        error.errorCode !== undefined &&
        error.errorCode !== null
          ? error.errorCode
          : EmmettError.Codes.InternalServerError,
      message: error.message ?? 'An unknown error occurred',
    });
  }

  public static isInstanceOf<ErrorType extends EmmettError = EmmettError>(
    error: unknown,
    errorCode?: (typeof EmmettError.Codes)[keyof typeof EmmettError.Codes],
  ): error is ErrorType {
    return (
      typeof error === 'object' &&
      error !== null &&
      'errorCode' in error &&
      isNumber(error.errorCode) &&
      (errorCode === undefined || error.errorCode === errorCode)
    );
  }
}

export class ConcurrencyError extends EmmettError {
  constructor(
    public current: string | undefined,
    public expected: string,
    message?: string,
  ) {
    super({
      errorCode: EmmettError.Codes.ConcurrencyError,
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
  constructor(message?: string) {
    super({
      errorCode: EmmettError.Codes.ConcurrencyError,
      message: message ?? `Expected document state does not match current one!`,
    });

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, ConcurrencyInMemoryDatabaseError.prototype);
  }
}

export class ValidationError extends EmmettError {
  constructor(message?: string) {
    super({
      errorCode: EmmettError.Codes.ValidationError,
      message: message ?? `Validation Error ocurred during Emmett processing`,
    });

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class IllegalStateError extends EmmettError {
  constructor(message?: string) {
    super({
      errorCode: EmmettError.Codes.IllegalStateError,
      message: message ?? `Illegal State ocurred during Emmett processing`,
    });

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, IllegalStateError.prototype);
  }
}

export class NotFoundError extends EmmettError {
  constructor(options?: { id: string; type: string; message?: string }) {
    super({
      errorCode: EmmettError.Codes.NotFoundError,
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
