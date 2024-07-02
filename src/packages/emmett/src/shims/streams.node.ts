import streamsPolyfill from 'web-streams-polyfill';

let streams: typeof streamsPolyfill;

if (
  globalThis &&
  // @ts-expect-error global object check
  globalThis.WritableStream &&
  // @ts-expect-error global object check
  globalThis.ReadableStream &&
  // @ts-expect-error global object check
  globalThis.TransformStream
) {
  // @ts-expect-error global object check
  streams = globalThis as typeof streamsPolyfill;
} else {
  try {
    // @ts-expect-error global object check
    streams = (await import('node:stream/web')) as typeof streamsPolyfill;
  } catch {
    // Just falling back to the default polyfill
    streams = streamsPolyfill;
  }
}

export default streams;

// Use a type-only import/export to re-export all types
export type * from 'web-streams-polyfill';
