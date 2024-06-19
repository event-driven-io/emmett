import asyncRetry from 'async-retry';
import {
  ReadableStream,
  TransformStream,
  TransformStreamDefaultController,
  type ReadableStreamDefaultReadResult,
} from 'web-streams-polyfill';

export const retry = <
  Source = unknown,
  Transformed = Source,
  StreamType = Source,
>(
  createSourceStream: () => ReadableStream<StreamType>,
  handleChunk: (
    readResult: ReadableStreamDefaultReadResult<StreamType>,
    controller: TransformStreamDefaultController<Transformed>,
  ) => Promise<boolean> | boolean,
  retryOptions: asyncRetry.Options = { forever: true, minTimeout: 25 },
): TransformStream<Source, Transformed> =>
  new TransformStream<Source, Transformed>({
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
  ) => Promise<boolean> | boolean,
  controller: TransformStreamDefaultController<Transformed>,
): Promise<void> => {
  const sourceStream = createSourceStream();
  const reader = sourceStream.getReader();

  try {
    let done: boolean;

    do {
      const result = await reader.read();
      done = await handleChunk(result, controller);
    } while (!done);
  } finally {
    reader.releaseLock();
  }
};
