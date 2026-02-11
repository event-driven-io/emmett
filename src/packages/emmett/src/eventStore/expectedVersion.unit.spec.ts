import { describe, it } from 'node:test';
import { assertEqual, assertOk } from '../testing';
import {
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
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
