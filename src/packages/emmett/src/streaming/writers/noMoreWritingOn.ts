import type { TransformStream } from 'web-streams-polyfill';

export const noMoreWritingOn = async <In, Out>(
  stream: TransformStream<In, Out>,
) => {
  await stream.writable.close();
  return stream.readable;
};
