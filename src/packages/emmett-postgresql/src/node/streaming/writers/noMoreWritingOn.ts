import type { TransformStream } from 'node:stream/web';

export const noMoreWritingOn = async <In, Out>(
  stream: TransformStream<In, Out>,
) => {
  await stream.writable.close();
  return stream.readable;
};
