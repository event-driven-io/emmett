import retry from 'async-retry';
import {
  ReadableStream,
  ReadableStreamDefaultReader,
  TransformStream,
  TransformStreamDefaultController,
} from 'web-streams-polyfill';
import type { Decoder } from './decoders';
import { DefaultDecoder } from './decoders/composite';

export const restream = <
  Source = unknown,
  Transformed = Source,
  StreamType = Source,
>(
  createSourceStream: () => ReadableStream<StreamType>,
  transform: (input: Source) => Transformed = (source) =>
    source as unknown as Transformed,
  retryOptions: retry.Options = { forever: true, minTimeout: 25 },
  decoder: Decoder<StreamType, Source> = new DefaultDecoder<Source>(),
): ReadableStream<Transformed> =>
  new TransformStream<Source, Transformed>({
    start(controller) {
      retry(
        () => onRestream(createSourceStream, controller, transform, decoder),
        retryOptions,
      ).catch((error) => {
        controller.error(error);
      });
    },
  }).readable;

const onRestream = async <StreamType, Source, Transformed = Source>(
  createSourceStream: () => ReadableStream<StreamType>,
  controller: TransformStreamDefaultController<Transformed>,
  transform: (input: Source) => Transformed,
  decoder: Decoder<StreamType, Source>,
): Promise<void> => {
  const sourceStream = createSourceStream();
  const reader = sourceStream.getReader();
  try {
    let done: boolean;

    do {
      done = await restreamChunk(reader, controller, transform, decoder);
    } while (!done);
  } finally {
    reader.releaseLock();
  }
};

const restreamChunk = async <StreamType, Source, Transformed = Source>(
  reader: ReadableStreamDefaultReader<StreamType>,
  controller: TransformStreamDefaultController<Transformed>,
  transform: (input: Source) => Transformed,
  decoder: Decoder<StreamType, Source>,
): Promise<boolean> => {
  const { done: isDone, value } = await reader.read();

  if (value) decoder.addToBuffer(value);

  if (!isDone && !decoder.hasCompleteMessage()) return false;

  decodeAndTransform(decoder, transform, controller);

  if (isDone) {
    controller.terminate();
  }

  return isDone;
};

const decodeAndTransform = <StreamType, Source, Transformed = Source>(
  decoder: Decoder<StreamType, Source>,
  transform: (input: Source) => Transformed,
  controller: TransformStreamDefaultController<Transformed>,
) => {
  try {
    const decoded = decoder.decode();
    if (!decoded) return;

    const transformed = transform(decoded);
    controller.enqueue(transformed);
  } catch (error) {
    controller.error(new Error(`Decoding error: ${error?.toString()}`));
  }
};
