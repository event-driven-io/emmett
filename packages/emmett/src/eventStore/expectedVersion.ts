import type { Flavour } from '../typing';
import type { DefaultStreamVersionType } from './eventStore';

export type ExpectedStreamVersion<VersionType = DefaultStreamVersionType> =
  | ExpectedStreamVersionWithValue<VersionType>
  | ExpectedStreamVersionGeneral;

export type ExpectedStreamVersionWithValue<
  VersionType = DefaultStreamVersionType,
> = Flavour<VersionType, 'StreamVersion'>;

export type ExpectedStreamVersionGeneral = Flavour<
  'STREAM_EXISTS' | 'STREAM_DOES_NOT_EXIST' | 'NO_CONCURRENCY_CHECK',
  'StreamVersion'
>;

export const STREAM_EXISTS = 'STREAM_EXISTS' as ExpectedStreamVersionGeneral;
export const STREAM_DOES_NOT_EXIST =
  'STREAM_DOES_NOT_EXIST' as ExpectedStreamVersionGeneral;
export const NO_CONCURRENCY_CHECK =
  'NO_CONCURRENCY_CHECK' as ExpectedStreamVersionGeneral;

export const matchesExpectedVersion = <
  StreamVersion = DefaultStreamVersionType,
>(
  current: StreamVersion | undefined,
  expected: ExpectedStreamVersion<StreamVersion>,
): boolean => {
  if (expected === NO_CONCURRENCY_CHECK) return true;

  if (expected == STREAM_DOES_NOT_EXIST) return current === undefined;

  if (expected == STREAM_EXISTS) return current !== undefined;

  return current === expected;
};

export const assertExpectedVersionMatchesCurrent = <
  StreamVersion = DefaultStreamVersionType,
>(
  current: StreamVersion | undefined,
  expected: ExpectedStreamVersion<StreamVersion> | undefined,
): void => {
  expected ??= NO_CONCURRENCY_CHECK;

  if (!matchesExpectedVersion(current, expected))
    throw new ExpectedVersionConflictError(current, expected);
};

export class ExpectedVersionConflictError<
  VersionType = DefaultStreamVersionType,
> extends Error {
  constructor(
    public current: VersionType | undefined,
    public expected: ExpectedStreamVersion<VersionType>,
  ) {
    super(
      `Expected version ${expected.toString()} does not match current ${current?.toString()}`,
    );

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, ExpectedVersionConflictError.prototype);
  }
}
