import type { TransformStream } from '@event-driven-io/emmett-shims';

export const noMoreWritingOn = async <In, Out>(
  stream: TransformStream<In, Out>,
) => {
  await stream.writable.close();
  return stream.readable;
};
