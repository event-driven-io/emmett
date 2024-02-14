import {
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  matchesExpectedVersion,
} from './expectedVersion';

describe('matchesExpectedVersion', () => {
  it('When NO_CONCURRENCY_CHECK provided returns `true` for any current version', () => {
    const allCurrentVersions = [undefined, 0, -1, 1, 100, 'random', ''];

    for (const currentStreamVersion of allCurrentVersions) {
      expect(
        matchesExpectedVersion(currentStreamVersion, NO_CONCURRENCY_CHECK),
      ).toBeTruthy();
    }
  });

  it('When STREAM_DOES_NOT_EXIST provided returns `true` for current equals `undefined`', () => {
    expect(
      matchesExpectedVersion(undefined, STREAM_DOES_NOT_EXIST),
    ).toBeTruthy();
  });

  it('When STREAM_DOES_NOT_EXIST provided returns `false` for current different than `undefined`', () => {
    const definedStreamVersion = [0, -1, 1, 100, 'random', ''];

    for (const currentStreamVersion of definedStreamVersion) {
      expect(
        matchesExpectedVersion(currentStreamVersion, STREAM_DOES_NOT_EXIST),
      ).toBeFalsy();
    }
  });

  it('When STREAM_EXISTS provided returns `true` for current different than `undefined`', () => {
    const definedStreamVersion = [0, -1, 1, 100, 'random', ''];

    for (const currentStreamVersion of definedStreamVersion) {
      expect(
        matchesExpectedVersion(currentStreamVersion, STREAM_EXISTS),
      ).toBeTruthy();
    }
  });

  it('When STREAM_EXISTS provided returns `false` for current equals `undefined`', () => {
    expect(matchesExpectedVersion(undefined, STREAM_EXISTS)).toBeFalsy();
  });

  it('When value provided returns `true` for current matching expected value', () => {
    const definedStreamVersion = [0, -1, 1, 100, 'random', ''];

    for (const streamVersion of definedStreamVersion) {
      expect(matchesExpectedVersion(streamVersion, streamVersion)).toBeTruthy();
    }
  });

  it('When value provided returns `false` for current notmatching expected value', () => {
    const definedStreamVersion = [
      { current: 100, expected: 0 },
      { current: 0, expected: -1 },
      { current: -1, expected: 1 },
      { current: 0, expected: 100 },
      { current: '', expected: 'random' },
      { current: 'random', expected: '' },
    ];

    for (const streamVersion of definedStreamVersion) {
      expect(
        matchesExpectedVersion(streamVersion.current, streamVersion.expected),
      ).toBeFalsy();
    }
  });
});
