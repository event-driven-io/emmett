import { ConcurrencyError } from '../errors';
import type { BigIntStreamPosition, Flavour } from '../typing';

export type ExpectedStreamVersion<VersionType = BigIntStreamPosition> =
  | ExpectedStreamVersionWithValue<VersionType>
  | ExpectedStreamVersionGeneral;

export type ExpectedStreamVersionWithValue<VersionType = BigIntStreamPosition> =
  Flavour<VersionType, 'StreamVersion'>;

export type ExpectedStreamVersionGeneral = Flavour<
  'STREAM_EXISTS' | 'STREAM_DOES_NOT_EXIST' | 'NO_CONCURRENCY_CHECK',
  'StreamVersion'
>;

export const STREAM_EXISTS = 'STREAM_EXISTS' as ExpectedStreamVersionGeneral;
export const STREAM_DOES_NOT_EXIST =
  'STREAM_DOES_NOT_EXIST' as ExpectedStreamVersionGeneral;
export const NO_CONCURRENCY_CHECK =
  'NO_CONCURRENCY_CHECK' as ExpectedStreamVersionGeneral;

export const matchesExpectedVersion = <StreamVersion = BigIntStreamPosition>(
  current: StreamVersion | undefined,
  expected: ExpectedStreamVersion<StreamVersion>,
  defaultVersion: StreamVersion,
): boolean => {
  if (expected === NO_CONCURRENCY_CHECK) return true;

  if (expected == STREAM_DOES_NOT_EXIST) return current === defaultVersion;

  if (expected == STREAM_EXISTS) return current !== defaultVersion;

  return current === expected;
};

export const assertExpectedVersionMatchesCurrent = <
  StreamVersion = BigIntStreamPosition,
>(
  current: StreamVersion,
  expected: ExpectedStreamVersion<StreamVersion> | undefined,
  defaultVersion: StreamVersion,
): void => {
  expected ??= NO_CONCURRENCY_CHECK;

  if (!matchesExpectedVersion(current, expected, defaultVersion))
    throw new ExpectedVersionConflictError(current, expected);
};

export class ExpectedVersionConflictError<
  VersionType = BigIntStreamPosition,
> extends ConcurrencyError {
  constructor(
    current: VersionType,
    expected: ExpectedStreamVersion<VersionType>,
  ) {
    super(current?.toString(), expected?.toString());

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, ExpectedVersionConflictError.prototype);
  }
}

export const isExpectedVersionConflictError = (
  error: unknown,
): error is ExpectedVersionConflictError =>
  error instanceof ExpectedVersionConflictError;
