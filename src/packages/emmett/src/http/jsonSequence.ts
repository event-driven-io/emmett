export const JSONSequenceContentType = 'application/json-seq';

const RecordSeparator = '\u001e';
const LineFeed = '\n';

export type JSONSequenceStreamOptions<T> = {
  signal?: AbortSignal;
  serialize?: (value: T) => string;
};

/**
 * Streams records from an async source as an RFC 7464 JSON Text Sequence.
 *
 * The source is pulled only when the consumer asks for more data, so a slow
 * reader applies backpressure instead of causing unbounded buffering.
 * Cancelling the stream or aborting the signal stops the source iterator.
 */
export const jsonSequenceStream = <T>(
  source: AsyncIterable<T>,
  options?: JSONSequenceStreamOptions<T>,
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const serialize = options?.serialize ?? ((value: T) => JSON.stringify(value));
  const iterator = source[Symbol.asyncIterator]();
  let finished = false;

  const stopSource = async () => {
    if (finished) return;
    finished = true;
    await iterator.return?.();
  };

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const signal = options?.signal;
        if (!signal) return;

        const onAbort = () => {
          void stopSource();
          try {
            controller.close();
          } catch {
            // stream was already closed or cancelled
          }
        };

        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      },
      async pull(controller) {
        if (finished) return;

        try {
          const result = await iterator.next();

          if (finished) return;

          if (result.done) {
            finished = true;
            controller.close();
            return;
          }

          controller.enqueue(
            encoder.encode(
              RecordSeparator + serialize(result.value) + LineFeed,
            ),
          );
        } catch (error) {
          finished = true;
          controller.error(error);
        }
      },
      cancel() {
        return stopSource();
      },
    },
    { highWaterMark: 0 },
  );
};
