import type { ReadableStream } from 'web-streams-polyfill';

export const collectStream = async <T>(
  stream: ReadableStream<T>,
): Promise<T[]> => {
  const results: T[] = [];

  for await (const value of stream) {
    results.push(value as T);
  }

  return results;
};

// export const first = async <T>(
//   stream: ReadableStream<T>,
//   filter?: (item: T) => boolean,
// ): Promise<T[]> => {
//   const results: T[] = [];

//   const reader = stream.getReader();

//   consr

//   for await (const value of stream) {
//     if (!filter || filter(value as T)) results.push(value as T);
//   }

//   return results;
// };
