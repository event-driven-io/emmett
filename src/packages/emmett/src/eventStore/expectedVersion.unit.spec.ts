import { describe, expectTypeOf, it } from 'vitest';
import { ConcurrencyError, EmmettError } from '../errors';
import { assertDeepEqual, assertEqual, assertOk, assertTrue } from '../testing';
import {
  ExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  isExpectedVersionConflictError,
  matchesExpectedVersion,
} from './expectedVersion';

void describe('matchesExpectedVersion', () => {
  const defaultVersion = -123n;
  void it('When NO_CONCURRENCY_CHECK provided returns `true` for any current version', () => {
    const allCurrentVersions = [defaultVersion, 0n, -1n, 1n, 100n];

    for (const currentStreamVersion of allCurrentVersions) {
      assertOk(
        matchesExpectedVersion(
          currentStreamVersion,
          NO_CONCURRENCY_CHECK,
          defaultVersion,
        ),
      );
    }
  });

  void it('When STREAM_DOES_NOT_EXIST provided returns `true` for current equals default version', () => {
    assertOk(
      matchesExpectedVersion(
        defaultVersion,
        STREAM_DOES_NOT_EXIST,
        defaultVersion,
      ),
    );
  });

  void it('When STREAM_DOES_NOT_EXIST provided returns `false` for current different than default version', () => {
    const definedStreamVersion = [0n, -1n, 1n, 100n];

    for (const currentStreamVersion of definedStreamVersion) {
      assertEqual(
        matchesExpectedVersion(
          currentStreamVersion,
          STREAM_DOES_NOT_EXIST,
          defaultVersion,
        ),
        false,
      );
    }
  });

  void it('When STREAM_EXISTS provided returns `true` for current different than default version', () => {
    const definedStreamVersion = [0n, -1n, 1n, 100n];

    for (const currentStreamVersion of definedStreamVersion) {
      assertOk(
        matchesExpectedVersion(
          currentStreamVersion,
          STREAM_EXISTS,
          defaultVersion,
        ),
      );
    }
  });

  void it('When STREAM_EXISTS provided returns `false` for current equals default version', () => {
    assertEqual(
      matchesExpectedVersion(defaultVersion, STREAM_EXISTS, defaultVersion),
      false,
    );
  });

  void it('When value provided returns `true` for current matching expected value', () => {
    const definedStreamVersion = [0n, -1n, 1n, 100n];

    for (const streamVersion of definedStreamVersion) {
      assertOk(
        matchesExpectedVersion(streamVersion, streamVersion, defaultVersion),
      );
    }
  });

  void it('When value provided returns `false` for current notmatching expected value', () => {
    const definedStreamVersion = [
      { current: 100n, expected: 0n },
      { current: 0n, expected: -1n },
      { current: -1n, expected: 1n },
      { current: 0n, expected: 100n },
    ];

    for (const streamVersion of definedStreamVersion) {
      assertEqual(
        matchesExpectedVersion(
          streamVersion.current,
          streamVersion.expected,
          defaultVersion,
        ),
        false,
      );
    }
  });
});

void describe('ExpectedVersionConflictError', () => {
  void it('keeps its current arguments', () => {
    const error = new ExpectedVersionConflictError(1n, 2n);

    assertEqual(error.status, EmmettError.Codes.ConcurrencyError);
    assertEqual(error.current, '1');
    assertEqual(error.expected, '2');
    assertEqual(error.message, 'Expected version 2 does not match current 1');
    assertTrue(error instanceof ConcurrencyError);
    assertTrue(isExpectedVersionConflictError(error));
  });

  void it('has a default code', () => {
    const error = new ExpectedVersionConflictError(1n, 2n);

    assertEqual(error.code, 'EMT_ERR_EXPECTED_VERSION_CONFLICT');
  });

  void it('has a default code when options are passed without code', () => {
    const error = new ExpectedVersionConflictError(1n, 2n, 'Booking changed');

    assertEqual(error.message, 'Booking changed');
    assertEqual(error.code, 'EMT_ERR_EXPECTED_VERSION_CONFLICT');
  });

  void it('carries code, cause and details', () => {
    const cause = new Error('Original failure');
    const details = { propertyId: 'property-1' };

    const error = new ExpectedVersionConflictError(1n, 2n, {
      message: 'Booking changed',
      code: 'BOOKING_CHANGED',
      cause,
      details,
    });

    assertEqual(error.status, EmmettError.Codes.ConcurrencyError);
    assertEqual(error.message, 'Booking changed');
    assertEqual(error.code, 'BOOKING_CHANGED');
    assertEqual(error.cause, cause);
    assertDeepEqual(error.details, details);
  });

  void it('accepts the same options as ConcurrencyError', () => {
    expectTypeOf<
      ConstructorParameters<typeof ExpectedVersionConflictError>[2]
    >().toEqualTypeOf<ConstructorParameters<typeof ConcurrencyError>[2]>();
  });
});
