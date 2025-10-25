import type { ReadableStream } from 'node:stream/web';

export const collect = async <T>(stream: ReadableStream<T>): Promise<T[]> => {
  const results: T[] = [];

  for await (const value of stream) {
    results.push(value);
  }

  return results;
};
