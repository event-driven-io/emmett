import { ConcurrencyError, EmmettError } from '../errors';
import type { Flavour, StreamPosition } from '../typing';

export type ExpectedStreamVersion =
  | ExpectedStreamVersionWithValue
  | ExpectedStreamVersionGeneral;

export type ExpectedStreamVersionWithValue = Flavour<
  StreamPosition,
  'StreamVersion'
>;

export type ExpectedStreamVersionGeneral = Flavour<
  'STREAM_EXISTS' | 'STREAM_DOES_NOT_EXIST' | 'NO_CONCURRENCY_CHECK',
  'StreamVersion'
>;

export const STREAM_EXISTS = 'STREAM_EXISTS' as ExpectedStreamVersionGeneral;
export const STREAM_DOES_NOT_EXIST =
  'STREAM_DOES_NOT_EXIST' as ExpectedStreamVersionGeneral;
export const NO_CONCURRENCY_CHECK =
  'NO_CONCURRENCY_CHECK' as ExpectedStreamVersionGeneral;

export const matchesExpectedVersion = (
  current: StreamPosition | undefined,
  expected: ExpectedStreamVersion,
  defaultVersion: StreamPosition,
): boolean => {
  if (expected === NO_CONCURRENCY_CHECK) return true;

  if (expected == STREAM_DOES_NOT_EXIST) return current === defaultVersion;

  if (expected == STREAM_EXISTS) return current !== defaultVersion;

  return current === expected;
};

export const assertExpectedVersionMatchesCurrent = (
  current: StreamPosition,
  expected: ExpectedStreamVersion | undefined,
  defaultVersion: StreamPosition,
): void => {
  expected ??= NO_CONCURRENCY_CHECK;

  if (!matchesExpectedVersion(current, expected, defaultVersion))
    throw new ExpectedVersionConflictError(current, expected);
};

export class ExpectedVersionConflictError extends ConcurrencyError {
  constructor(current: StreamPosition, expected: ExpectedStreamVersion) {
    super(current?.toString(), expected?.toString());

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, ExpectedVersionConflictError.prototype);
  }
}

export const isExpectedVersionConflictError = (
  error: unknown,
): error is ExpectedVersionConflictError =>
  error instanceof ExpectedVersionConflictError ||
  EmmettError.isInstanceOf<ConcurrencyError>(
    error,
    ExpectedVersionConflictError.Codes.ConcurrencyError,
  );
