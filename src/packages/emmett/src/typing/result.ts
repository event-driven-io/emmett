import type { Brand } from '.';

export const EmptySuccessValue = Symbol.for('emt:result:success:emptyvalue');
export type EmptySuccessValue = typeof EmptySuccessValue;

export const EmptyFailureValue = Symbol.for('emt:result:failure:emptyvalue');
export type EmptyFailureValue = typeof EmptyFailureValue;

export type Success<Value = EmptySuccessValue> = Readonly<
  Brand<
    {
      ok: true;
      value: Value;
    },
    'SuccessResult'
  >
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySuccess = Success<any>;

export type Failure<ErrorType = unknown> = Readonly<
  Brand<
    {
      ok: false;
      error: ErrorType;
    },
    'FailureResult'
  >
>;

export type Result<Value = EmptySuccessValue, ErrorType = EmptyFailureValue> =
  | Success<Value>
  | Failure<ErrorType>;

export const success = <Value = EmptySuccessValue>(
  ...args: Value extends EmptySuccessValue ? [] : [value: Value]
): Success<Value> => {
  const [value] = args;

  return {
    ok: true,
    value: value ?? EmptySuccessValue,
    __brand: 'SuccessResult',
  } as unknown as Success<Value>;
};
success.empty = success();

export const failure = <Error = EmptyFailureValue>(
  ...args: Error extends EmptyFailureValue ? [] : [error: Error]
): Failure<Error> => {
  const [error] = args;

  return {
    ok: false,
    error: error ?? EmptyFailureValue,
    __brand: 'FailureResult',
  } as unknown as Failure<Error>;
};
failure.empty = failure();

export const Result = {
  success,
  failure,
};
