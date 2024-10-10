import streams, {
  type ReadableStream,
  type ReadableStreamDefaultReadResult,
  type TransformStream,
  type TransformStreamDefaultController,
} from '@event-driven-io/emmett-shims';
import { type AsyncRetryOptions, asyncRetry } from '../../utils';

export const retryStream = <
  Source = unknown,
  Transformed = Source,
  StreamType = Source,
>(
  createSourceStream: () => ReadableStream<StreamType>,
  handleChunk: (
    readResult: ReadableStreamDefaultReadResult<StreamType>,
    controller: TransformStreamDefaultController<Transformed>,
  ) => Promise<void> | void,
  retryOptions: AsyncRetryOptions = { forever: true, minTimeout: 25 },
): TransformStream<Source, Transformed> =>
  new streams.TransformStream<Source, Transformed>({
    start(controller) {
      asyncRetry(
        () => onRestream(createSourceStream, handleChunk, controller),
        retryOptions,
      ).catch((error) => {
        controller.error(error);
      });
    },
  });

const onRestream = async <StreamType, Source, Transformed = Source>(
  createSourceStream: () => ReadableStream<StreamType>,
  handleChunk: (
    readResult: ReadableStreamDefaultReadResult<StreamType>,
    controller: TransformStreamDefaultController<Transformed>,
  ) => Promise<void> | void,
  controller: TransformStreamDefaultController<Transformed>,
): Promise<void> => {
  const sourceStream = createSourceStream();
  const reader = sourceStream.getReader();

  try {
    let done: boolean;

    do {
      const result = await reader.read();
      done = result.done;

      await handleChunk(result, controller);

      if (done) {
        controller.terminate();
      }
    } while (!done);
  } finally {
    reader.releaseLock();
  }
};
