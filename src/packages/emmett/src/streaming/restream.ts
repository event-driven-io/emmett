import asyncRetry from 'async-retry';
import {
  ReadableStream,
  TransformStreamDefaultController,
  type ReadableStreamDefaultReadResult,
} from 'web-streams-polyfill';
import type { Decoder } from './decoders';
import { DefaultDecoder } from './decoders/composite';
import { streamTransformations } from './transformations';

const { retry } = streamTransformations;

export const restream = <
  Source = unknown,
  Transformed = Source,
  StreamType = Source,
>(
  createSourceStream: () => ReadableStream<StreamType>,
  transform: (input: Source) => Transformed = (source) =>
    source as unknown as Transformed,
  retryOptions: asyncRetry.Options = { forever: true, minTimeout: 25 },
  decoder: Decoder<StreamType, Source> = new DefaultDecoder<Source>(),
): ReadableStream<Transformed> =>
  retry(createSourceStream, handleChunk(transform, decoder), retryOptions)
    .readable;

const handleChunk =
  <Source = unknown, Transformed = Source, StreamType = Source>(
    transform: (input: Source) => Transformed = (source) =>
      source as unknown as Transformed,
    decoder: Decoder<StreamType, Source> = new DefaultDecoder<Source>(),
  ) =>
  (
    readResult: ReadableStreamDefaultReadResult<StreamType>,
    controller: TransformStreamDefaultController<Transformed>,
  ): void => {
    const { done: isDone, value } = readResult;

    if (value) decoder.addToBuffer(value);

    if (!isDone && !decoder.hasCompleteMessage()) return;

    decodeAndTransform(decoder, transform, controller);
  };

const decodeAndTransform = <StreamType, Source, Transformed = Source>(
  decoder: Decoder<StreamType, Source>,
  transform: (input: Source) => Transformed,
  controller: TransformStreamDefaultController<Transformed>,
) => {
  try {
    const decoded = decoder.decode();
    if (!decoded) return; // TODO: Add a proper handling of decode errors

    const transformed = transform(decoded);
    controller.enqueue(transformed);
  } catch (error) {
    controller.error(new Error(`Decoding error: ${error?.toString()}`));
  }
};
