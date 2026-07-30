import { EmmettError } from '../errors';

export type FusionStreamOptions = {
  signal?: AbortSignal;
};

export type ChunkOptions = {
  size: number;
  /**
   * How long a partial chunk may wait for more values before it is yielded
   * anyway, counted from the chunk's first value. Without it a chunk waits
   * until it is full, so a slow trickle of values would sit in the stream for
   * as long as it takes to gather `size` of them.
   */
  deadlineInMs?: number;
};

/**
 * A lazy chain over an async iterable. Nothing is pulled from the source until
 * the chain is iterated, so backpressure reaches whatever produces the values.
 */
export type FusionStream<T> = AsyncIterable<T> & {
  map: <Mapped>(map: (value: T) => Mapped) => FusionStream<Mapped>;
  flatMap: <Mapped>(map: (value: T) => Mapped[]) => FusionStream<Mapped>;
  chunk: (options: ChunkOptions) => FusionStream<T[]>;
  toArray: () => Promise<T[]>;
};

const mapped = async function* <T, Mapped>(
  source: AsyncIterable<T>,
  map: (value: T) => Mapped,
): AsyncIterable<Mapped> {
  for await (const value of source) yield map(value);
};

const flatMapped = async function* <T, Mapped>(
  source: AsyncIterable<T>,
  map: (value: T) => Mapped[],
): AsyncIterable<Mapped> {
  for await (const value of source) yield* map(value);
};

const DeadlineReached = Symbol('DeadlineReached');
const Aborted = Symbol('Aborted');

type Deadline = {
  reached: Promise<typeof DeadlineReached>;
  cancel: () => void;
};

/**
 * A one-shot timer that can be cancelled, which is what separates it from
 * `delayOrAbort`: a chunk that fills up before its deadline has to drop the
 * timer, otherwise every full chunk would leave one behind.
 */
const armDeadline = (ms: number, signal: AbortSignal | undefined): Deadline => {
  let cancel = () => {};

  const reached = new Promise<typeof DeadlineReached>((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', done);
      resolve(DeadlineReached);
    };

    const timeout = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });

    cancel = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', done);
    };
  });

  return { reached, cancel };
};

const whenAborted = (signal: AbortSignal | undefined) =>
  new Promise<typeof Aborted>((resolve) => {
    if (signal === undefined) return;
    if (signal.aborted) resolve(Aborted);
    else
      signal.addEventListener('abort', () => resolve(Aborted), { once: true });
  });

const chunked = <T>(
  source: AsyncIterable<T>,
  { size, deadlineInMs }: ChunkOptions,
  signal: AbortSignal | undefined,
): AsyncIterable<T[]> => ({
  [Symbol.asyncIterator]: async function* () {
    if (!Number.isInteger(size) || size < 1)
      throw new EmmettError(
        `Chunk size has to be an integer greater than 0, got: ${size}`,
      );

    const iterator = source[Symbol.asyncIterator]();

    // Racing the source against the signal is what keeps an idle chain
    // responsive to a stop: a source parked on its next value resolves
    // nothing, so without this the loop would sit there until it does.
    const aborted = whenAborted(signal);

    let chunk: T[] = [];
    let deadline: Deadline | null = null;
    let next: Promise<IteratorResult<T>> | null = null;

    const flush = (): T[] => {
      const flushed = chunk;

      chunk = [];
      deadline?.cancel();
      deadline = null;

      return flushed;
    };

    try {
      while (signal?.aborted !== true) {
        next ??= iterator.next();

        const result = await Promise.race(
          deadline ? [next, aborted, deadline.reached] : [next, aborted],
        );

        if (result === Aborted) return;

        if (result === DeadlineReached) {
          yield flush();
          continue;
        }

        next = null;

        if (result.done) break;

        chunk.push(result.value);

        if (chunk.length >= size) yield flush();
        else if (deadlineInMs !== undefined)
          deadline ??= armDeadline(deadlineInMs, signal);
      }

      if (chunk.length > 0 && signal?.aborted !== true) yield flush();
    } finally {
      deadline?.cancel();
      await iterator.return?.();
    }
  },
});

const fusionStream = <T>(
  source: AsyncIterable<T>,
  signal: AbortSignal | undefined,
): FusionStream<T> => ({
  [Symbol.asyncIterator]: () => source[Symbol.asyncIterator](),
  map: (map) => fusionStream(mapped(source, map), signal),
  flatMap: (map) => fusionStream(flatMapped(source, map), signal),
  chunk: (options) => fusionStream(chunked(source, options, signal), signal),
  toArray: async () => {
    const values: T[] = [];
    for await (const value of source) values.push(value);
    return values;
  },
});

/**
 * Composes async iterables without loading them into memory: every operator
 * wraps the previous one and pulls a value only when the chain is asked for
 * the next one. `signal` belongs to the whole chain, so stopping it stops
 * every operator in it.
 *
 * ```ts
 * const batches = await FusionStreams.from(messages, { signal })
 *   .chunk({ size: 100, deadlineInMs: 50 })
 *   .toArray();
 * ```
 */
export const FusionStreams = {
  from: <T>(
    source: AsyncIterable<T>,
    options?: FusionStreamOptions,
  ): FusionStream<T> => fusionStream(source, options?.signal),
};
