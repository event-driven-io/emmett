import * as streamsPolyfill from 'web-streams-polyfill';

let streams: typeof streamsPolyfill;

if (
  typeof globalThis !== 'undefined' &&
  'WritableStream' in globalThis &&
  'ReadableStream' in globalThis &&
  'TransformStream' in globalThis
) {
  console.log('importing from browser');
  streams = {
    // @ts-expect-error global object check
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    WritableStream: globalThis.WritableStream,
    // @ts-expect-error global object check
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    ReadableStream: globalThis.ReadableStream,
    // @ts-expect-error global object check
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    TransformStream: globalThis.TransformStream,
  } as unknown as typeof streamsPolyfill;
} else {
  try {
    console.log('importing from node');
    const nodeJsStreams = await import('node:stream/web');
    streams = {
      WritableStream: nodeJsStreams.WritableStream,
      ReadableStream: nodeJsStreams.ReadableStream,
      TransformStream: nodeJsStreams.TransformStream,
    } as unknown as typeof streamsPolyfill;
  } catch {
    console.log('falling back to polyfill');
    streams = streamsPolyfill;
  }
}

export default streams;

// Use a type-only import/export to re-export all types
export type * from 'web-streams-polyfill';

// https://github.com/jsdom/jsdom/issues/1537#issuecomment-229405327
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const isJsDom = (): boolean => {
  // @ts-expect-error global object check
  const globalWindow = window as { name: string };
  // @ts-expect-error global object check
  const globalNavigator = navigator as { userAgent: string };

  return (
    (typeof globalWindow !== 'undefined' && globalWindow.name === 'nodejs') ||
    (typeof globalNavigator !== 'undefined' &&
      'userAgent' in globalNavigator &&
      typeof globalNavigator.userAgent === 'string' &&
      (globalNavigator.userAgent.includes('Node.js') ||
        globalNavigator.userAgent.includes('jsdom')))
  );
};

const isDeno = (): boolean => {
  // @ts-expect-error global object check
  const globalDeno = Deno as { version: { deno: unknown } };

  return (
    typeof globalDeno !== 'undefined' &&
    typeof globalDeno.version !== 'undefined' &&
    typeof globalDeno.version.deno !== 'undefined'
  );
};

const isBun =
  typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.bun != null;

export { isBrowser, isBun, isDeno, isJsDom, isNode, isWebWorker };

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const isBrowser = (): boolean => {
  // @ts-expect-error global object check
  const globalWindow = window as { document: unknown };

  return (
    typeof globalWindow !== 'undefined' &&
    typeof globalWindow.document !== 'undefined'
  );
};

const isNode = (): boolean =>
  typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null;

const isWebWorker = (): boolean => {
  // @ts-expect-error global object check
  const globalSelf = self as { constructor: { name: unknown } | undefined };

  return (
    typeof globalSelf === 'object' &&
    !!globalSelf.constructor &&
    globalSelf.constructor.name === 'DedicatedWorkerGlobalScope'
  );
};
