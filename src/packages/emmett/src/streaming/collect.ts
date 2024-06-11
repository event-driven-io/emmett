import type { ReadableStream } from 'web-streams-polyfill';

export const collectStream = async <T>(
  reader: ReadableStream<T>,
  filter?: (item: T) => boolean,
): Promise<T[]> => {
  const results: T[] = [];

  for await (const value of reader) {
    if (!filter || filter(value as T)) results.push(value as T);
  }

  return results;
};
