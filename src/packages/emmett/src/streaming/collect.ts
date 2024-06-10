import type { ReadableStream } from '../shims/streams';

export const collectStream = async <T>(
  reader: ReadableStream<T>,
): Promise<T[]> => {
  const results: T[] = [];

  for await (const value of reader) {
    results.push(value as T);
  }
  return results;
};
