import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  matchesExpectedVersion,
} from './expectedVersion';

void describe('matchesExpectedVersion', () => {
  void it('When NO_CONCURRENCY_CHECK provided returns `true` for any current version', () => {
    const allCurrentVersions = [undefined, 0, -1, 1, 100, 'random', ''];

    for (const currentStreamVersion of allCurrentVersions) {
      assert.ok(
        matchesExpectedVersion(currentStreamVersion, NO_CONCURRENCY_CHECK),
      );
    }
  });

  void it('When STREAM_DOES_NOT_EXIST provided returns `true` for current equals `undefined`', () => {
    assert.ok(matchesExpectedVersion(undefined, STREAM_DOES_NOT_EXIST));
  });

  void it('When STREAM_DOES_NOT_EXIST provided returns `false` for current different than `undefined`', () => {
    const definedStreamVersion = [0, -1, 1, 100, 'random', ''];

    for (const currentStreamVersion of definedStreamVersion) {
      assert.equal(
        matchesExpectedVersion(currentStreamVersion, STREAM_DOES_NOT_EXIST),
        false,
      );
    }
  });

  void it('When STREAM_EXISTS provided returns `true` for current different than `undefined`', () => {
    const definedStreamVersion = [0, -1, 1, 100, 'random', ''];

    for (const currentStreamVersion of definedStreamVersion) {
      assert.ok(matchesExpectedVersion(currentStreamVersion, STREAM_EXISTS));
    }
  });

  void it('When STREAM_EXISTS provided returns `false` for current equals `undefined`', () => {
    assert.equal(matchesExpectedVersion(undefined, STREAM_EXISTS), false);
  });

  void it('When value provided returns `true` for current matching expected value', () => {
    const definedStreamVersion = [0, -1, 1, 100, 'random', ''];

    for (const streamVersion of definedStreamVersion) {
      assert.ok(matchesExpectedVersion(streamVersion, streamVersion));
    }
  });

  void it('When value provided returns `false` for current notmatching expected value', () => {
    const definedStreamVersion = [
      { current: 100, expected: 0 },
      { current: 0, expected: -1 },
      { current: -1, expected: 1 },
      { current: 0, expected: 100 },
      { current: '', expected: 'random' },
      { current: 'random', expected: '' },
    ];

    for (const streamVersion of definedStreamVersion) {
      assert.equal(
        matchesExpectedVersion(streamVersion.current, streamVersion.expected),
        false,
      );
    }
  });
});
