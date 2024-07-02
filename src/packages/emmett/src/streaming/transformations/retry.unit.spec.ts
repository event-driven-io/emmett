import {
  TransformStreamDefaultController,
  type ReadableStreamDefaultReadResult,
} from '@event-driven-io/emmett-shims';
import { describe, it } from 'node:test';
import { assertDeepEqual, assertEqual } from '../../testing';
import { fromArray } from '../generators/fromArray';
import { retry } from './retry';

void describe('retry', () => {
  void it('processes the stream successfully and terminate when done', async () => {
    const data = [1, 2, 3];
    const handleChunk = (
      readResult: ReadableStreamDefaultReadResult<number>,
      controller: TransformStreamDefaultController<number>,
    ) => {
      if (readResult.done) return;

      controller.enqueue(readResult.value * 2);
    };

    const transformStream = retry(() => fromArray(data), handleChunk, {
      retries: 3,
      minTimeout: 10,
    });

    const reader = transformStream.readable.getReader();
    const result = [];
    let readResult;

    while (!(readResult = await reader.read()).done) {
      result.push(readResult.value);
    }

    assertDeepEqual(result, [2, 4, 6]);
  });

  void it('retrieses on transient failure and process successfully after retries', async () => {
    let attempt = 0;
    const data = [1, 2, 3];
    const handleChunk = (
      readResult: ReadableStreamDefaultReadResult<number>,
      controller: TransformStreamDefaultController<number>,
    ) => {
      if (readResult.done) return;

      if (++attempt < 2) {
        throw new Error('Processing error');
      }
      controller.enqueue(readResult.value * 2);
    };

    const transformStream = retry(() => fromArray(data), handleChunk, {
      retries: 3,
      minTimeout: 10,
    });

    const reader = transformStream.readable.getReader();
    const result = [];
    let readResult;

    while (!(readResult = await reader.read()).done) {
      result.push(readResult.value);
    }

    assertDeepEqual(result, [2, 4, 6]);
  });

  void it('handle persistent stream errors and propagate them', async () => {
    const handleChunk = () => {
      throw new Error('Chunk processing failed');
    };

    let errorCaught = false;

    const transformStream = retry(() => fromArray([1, 2, 3]), handleChunk, {
      retries: 1,
      minTimeout: 10,
    });

    const reader = transformStream.readable.getReader();
    try {
      await reader.read();
    } catch (error) {
      errorCaught = true;
    }

    assertEqual(errorCaught, true);
  });
});
