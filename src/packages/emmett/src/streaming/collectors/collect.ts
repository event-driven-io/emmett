import type { ReadableStream } from '@event-driven-io/emmett-shims';

export const collect = async <T>(stream: ReadableStream<T>): Promise<T[]> => {
  const results: T[] = [];

  for await (const value of stream) {
    results.push(value as T);
  }

  return results;
};
