import { describe, expect, it } from 'vitest';
import {
  after,
  append,
  appendAndStop,
  before,
  composeMiddleware,
  reject,
  rejectOn,
  resolveMiddleware,
  skip,
  skipOn,
  stop,
  stopAfter,
  stopOn,
  throwOn,
} from './middleware';

describe('decision middleware', () => {
  it('composes the first middleware as the outermost wrapper', async () => {
    const calls: string[] = [];
    const handler = composeMiddleware(() => {
      calls.push('decision');
      return Promise.resolve(append(['event']));
    }, [
      before(() => {
        calls.push('first before');
      }),
      after((result) => {
        calls.push('second after');
        return result;
      }),
    ]);

    await handler('input', {});

    expect(calls).toEqual(['first before', 'decision', 'second after']);
  });

  it('constructs each result without transport or error details', () => {
    expect(append([1])).toEqual({ type: 'APPEND', outputs: [1] });
    expect(skip([1])).toEqual({ type: 'SKIP', outputs: [1] });
    expect(stop([1])).toEqual({ type: 'STOP', outputs: [1] });
    expect(reject([1])).toEqual({ type: 'REJECT', outputs: [1] });
    expect(appendAndStop([1])).toEqual({
      type: 'APPEND_AND_STOP',
      outputs: [1],
    });
  });

  it('normalizes array shorthand and lifecycle object configuration', () => {
    const decision = [before<string, object, string>(() => undefined)];
    const beforeAll = () => undefined;
    const afterAll = () => undefined;

    expect(resolveMiddleware(decision)).toEqual({
      beforeAll: undefined,
      afterAll: undefined,
      decision,
    });
    expect(resolveMiddleware({ beforeAll, afterAll, decision })).toEqual({
      beforeAll,
      afterAll,
      decision,
    });
  });

  it.each([
    [skipOn, 'SKIP'],
    [stopOn, 'STOP'],
    [rejectOn, 'REJECT'],
    [stopAfter, 'APPEND_AND_STOP'],
  ] as const)(
    '%s applies an any-output match to the whole decision',
    async (create, type) => {
      const handler = composeMiddleware(
        () => Promise.resolve(append(['keep', 'match', 'keep too'])),
        [create((output) => output === 'match')],
      );

      expect(await handler('input', {})).toEqual({
        type,
        outputs: ['keep', 'match', 'keep too'],
      });
    },
  );

  it('throwOn creates and propagates an exception for the matching output', async () => {
    const error = new Error('rejected');
    const handler = composeMiddleware(
      () => Promise.resolve(append(['ok', 'bad'])),
      [
        throwOn(
          (output) => output === 'bad',
          () => error,
        ),
      ],
    );

    await expect(handler('input', {})).rejects.toBe(error);
  });
});
