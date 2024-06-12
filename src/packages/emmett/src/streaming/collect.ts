import type { ReadableStream } from 'web-streams-polyfill';

export const collectStream = async <T>(
  reader: ReadableStream<T>,
): Promise<T[]> => {
  const results: T[] = [];

  for await (const value of reader) {
    results.push(value as T);
  }
  return results;
};
