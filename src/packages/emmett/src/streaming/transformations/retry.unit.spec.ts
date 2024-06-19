import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import {
  ReadableStream,
  TransformStreamDefaultController,
  type ReadableStreamDefaultReadResult,
} from 'web-streams-polyfill';
import { retry } from './retry';

const createMockStream = (data: any[]): ReadableStream<any> => {
  return new ReadableStream({
    async pull(controller) {
      data.forEach((item) => controller.enqueue(item));
      controller.close();
    },
  });
};

describe('retry', () => {
  it('processes the stream successfully and terminate when done', async () => {
    const data = [1, 2, 3];
    const handleChunk = async (
      readResult: ReadableStreamDefaultReadResult<number>,
      controller: TransformStreamDefaultController<number>,
    ) => {
      if (readResult.done) return;

      controller.enqueue(readResult.value * 2);
    };

    const transformStream = retry(() => createMockStream(data), handleChunk, {
      retries: 3,
      minTimeout: 10,
    });

    const reader = transformStream.readable.getReader();
    const result = [];
    let readResult;

    while (!(readResult = await reader.read()).done) {
      result.push(readResult.value);
    }

    assert.deepEqual(result, [2, 4, 6]);
  });

  it('retrieses on transient failure and process successfully after retries', async () => {
    let attempt = 0;
    const data = [1, 2, 3];
    const handleChunk = async (
      readResult: ReadableStreamDefaultReadResult<number>,
      controller: TransformStreamDefaultController<number>,
    ) => {
      if (readResult.done) return;

      if (++attempt < 2) {
        throw new Error('Processing error');
      }
      controller.enqueue(readResult.value * 2);
    };

    const transformStream = retry(() => createMockStream(data), handleChunk, {
      retries: 3,
      minTimeout: 10,
    });

    const reader = transformStream.readable.getReader();
    const result = [];
    let readResult;

    while (!(readResult = await reader.read()).done) {
      result.push(readResult.value);
    }

    assert.deepEqual(result, [2, 4, 6]);
  });

  it('handle persistent stream errors and propagate them', async () => {
    const handleChunk = async () => {
      throw new Error('Chunk processing failed');
    };

    let errorCaught = false;

    const transformStream = retry(
      () => createMockStream([1, 2, 3]),
      handleChunk,
      { retries: 1, minTimeout: 10 },
    );

    const reader = transformStream.readable.getReader();
    try {
      await reader.read();
    } catch (error) {
      errorCaught = true;
    }

    assert.equal(errorCaught, true);
  });
});
