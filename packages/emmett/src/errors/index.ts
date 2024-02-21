import { isNumber, isString } from '../validation';

export class EmmettError extends Error {
  public errorCode: number;

  constructor(
    options?: { errorCode: number; message?: string } | string | number,
  ) {
    const errorCode =
      options && typeof options === 'object' && 'errorCode' in options
        ? options.errorCode
        : isNumber(options)
          ? options
          : 500;
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
}

export class ConcurrencyError extends EmmettError {
  constructor(
    public current: string | undefined,
    public expected: string,
    message?: string,
  ) {
    super({
      errorCode: 412,
      message:
        message ??
        `Expected version ${expected.toString()} does not match current ${current?.toString()}`,
    });

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, ConcurrencyError.prototype);
  }
}

export class ValidationError extends EmmettError {
  constructor(message?: string) {
    super({
      errorCode: 400,
      message: message ?? `Validation Error ocurred during Emmett processing`,
    });

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class IllegalStateError extends EmmettError {
  constructor(message?: string) {
    super({
      errorCode: 403,
      message: message ?? `Illegal State ocurred during Emmett processing`,
    });

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, IllegalStateError.prototype);
  }
}

export class NotFoundError extends EmmettError {
  constructor(options?: { id: string; type: string; message?: string }) {
    super({
      errorCode: 404,
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
