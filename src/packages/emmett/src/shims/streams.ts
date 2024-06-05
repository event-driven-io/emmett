import streamsPolyfill from 'web-streams-polyfill';

let streams = streamsPolyfill;

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
  streams = globalThis;
} else {
  try {
    // @ts-expect-error global object check
    streams = await import('node:stream/web');
  } catch {
    // just falling back to the default pollyfill
  }
}

export default streams;
