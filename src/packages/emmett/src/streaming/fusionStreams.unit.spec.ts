import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { assertEqual, assertDeepEqual } from '../testing';
import { asyncAwaiter } from '../utils';
import { FusionStreams } from './fusionStreams';

// eslint-disable-next-line @typescript-eslint/require-await
const from = async function* <T>(...values: T[]): AsyncIterable<T> {
  for (const value of values) yield value;
};

/**
 * Stands in for a source that yields when something happens rather than when
 * asked, which is the only way to tell a deadline flush from a size flush.
 */
const channel = <T>(signal: AbortSignal) => {
  const pending: T[] = [];
  let awaiter = asyncAwaiter<void>();
  let ended = false;

  signal.addEventListener(
    'abort',
    () => {
      ended = true;
      awaiter.resolve();
    },
    { once: true },
  );

  return {
    push: (value: T) => {
      pending.push(value);
      awaiter.resolve();
    },
    end: () => {
      ended = true;
      awaiter.resolve();
    },
    read: async function* (): AsyncIterable<T> {
      while (!ended || pending.length > 0) {
        while (pending.length > 0) yield pending.shift()!;

        if (ended) return;

        await awaiter.wait;
        awaiter = asyncAwaiter<void>();
      }
    },
  };
};

const collect = <T>(source: AsyncIterable<T>) => {
  const values: T[] = [];
  const completed = (async () => {
    for await (const value of source) values.push(value);
  })();

  return { values, completed };
};

const settle = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};

void describe('FusionStreams', () => {
  void it('maps every value', async () => {
    const doubled = await FusionStreams.from(from(1, 2, 3))
      .map((value) => value * 2)
      .toArray();

    assertDeepEqual(doubled, [2, 4, 6]);
  });

  void it('flattens what the mapping returns', async () => {
    const flattened = await FusionStreams.from(from(1, 2))
      .flatMap((value) => [value, value * 10])
      .toArray();

    assertDeepEqual(flattened, [1, 10, 2, 20]);
  });

  void it('drops a value that maps to nothing', async () => {
    const flattened = await FusionStreams.from(from(1, 2, 3))
      .flatMap((value) => (value % 2 === 0 ? [] : [value]))
      .toArray();

    assertDeepEqual(flattened, [1, 3]);
  });

  void it('reads nothing from the source until the stream is iterated', async () => {
    let pulled = 0;

    // eslint-disable-next-line @typescript-eslint/require-await
    const counting = async function* () {
      for (const value of [1, 2, 3]) {
        pulled++;
        yield value;
      }
    };

    const stream = FusionStreams.from(counting()).chunk({ size: 2 });

    assertEqual(pulled, 0);

    assertDeepEqual(await stream.toArray(), [[1, 2], [3]]);
    assertEqual(pulled, 3);
  });

  void describe('chunk', () => {
    void it('yields a full chunk as soon as it fills', async () => {
      const chunks = await FusionStreams.from(from(1, 2, 3, 4, 5))
        .chunk({ size: 2 })
        .toArray();

      assertDeepEqual(chunks, [[1, 2], [3, 4], [5]]);
    });

    void it('yields what is left when the source ends', async () => {
      const chunks = await FusionStreams.from(from(1))
        .chunk({ size: 10 })
        .toArray();

      assertDeepEqual(chunks, [[1]]);
    });

    void it('yields nothing for an empty source', async () => {
      const chunks = await FusionStreams.from(from<number>())
        .chunk({ size: 10 })
        .toArray();

      assertDeepEqual(chunks, []);
    });

    void it('rejects a size that would hold every value', async () => {
      const chunks = FusionStreams.from(from(1)).chunk({ size: 0 });

      let message = '';
      try {
        await chunks.toArray();
      } catch (error) {
        message = (error as Error).message;
      }

      assertEqual(
        message,
        'Chunk size has to be an integer greater than 0, got: 0',
      );
    });

    void describe('with a deadline', () => {
      beforeEach(() => vi.useFakeTimers());
      afterEach(() => vi.useRealTimers());

      void it('yields a partial chunk once the deadline elapses', async () => {
        const controller = new AbortController();
        const source = channel<number>(controller.signal);

        const collected = collect(
          FusionStreams.from(source.read(), {
            signal: controller.signal,
          }).chunk({ size: 10, deadlineInMs: 50 }),
        );

        source.push(1);
        await settle();

        assertDeepEqual(collected.values, []);

        await vi.advanceTimersByTimeAsync(49);
        assertDeepEqual(collected.values, []);

        await vi.advanceTimersByTimeAsync(1);
        assertDeepEqual(collected.values, [[1]]);

        controller.abort();
        await collected.completed;
      });

      void it('counts the deadline from the chunk first value, not its last', async () => {
        const controller = new AbortController();
        const source = channel<number>(controller.signal);

        const collected = collect(
          FusionStreams.from(source.read(), {
            signal: controller.signal,
          }).chunk({ size: 10, deadlineInMs: 50 }),
        );

        source.push(1);
        await vi.advanceTimersByTimeAsync(40);
        source.push(2);
        await vi.advanceTimersByTimeAsync(10);

        assertDeepEqual(collected.values, [[1, 2]]);

        controller.abort();
        await collected.completed;
      });

      void it('arms no deadline while the source stays idle', async () => {
        const controller = new AbortController();
        const source = channel<number>(controller.signal);

        const collected = collect(
          FusionStreams.from(source.read(), {
            signal: controller.signal,
          }).chunk({ size: 10, deadlineInMs: 50 }),
        );

        await vi.advanceTimersByTimeAsync(500);

        assertDeepEqual(collected.values, []);
        assertEqual(vi.getTimerCount(), 0);

        controller.abort();
        await collected.completed;
      });

      void it('drops the deadline of a chunk that filled up', async () => {
        const controller = new AbortController();
        const source = channel<number>(controller.signal);

        const collected = collect(
          FusionStreams.from(source.read(), {
            signal: controller.signal,
          }).chunk({ size: 2, deadlineInMs: 50 }),
        );

        source.push(1);
        source.push(2);
        await settle();

        assertDeepEqual(collected.values, [[1, 2]]);
        assertEqual(vi.getTimerCount(), 0);

        controller.abort();
        await collected.completed;
      });

      void it('stops when aborted mid deadline and leaves no timer behind', async () => {
        const controller = new AbortController();
        const source = channel<number>(controller.signal);

        const collected = collect(
          FusionStreams.from(source.read(), {
            signal: controller.signal,
          }).chunk({ size: 10, deadlineInMs: 50 }),
        );

        source.push(1);
        await vi.advanceTimersByTimeAsync(10);

        assertEqual(vi.getTimerCount(), 1);

        controller.abort();
        await collected.completed;

        assertEqual(vi.getTimerCount(), 0);
      });
    });
  });
});
