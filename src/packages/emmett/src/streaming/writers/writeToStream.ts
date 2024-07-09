import type {
  ReadableStream,
  TransformStream,
} from '@event-driven-io/emmett-shims';
import { noMoreWritingOn } from './noMoreWritingOn';

export const writeToStream = async <In, Out>(
  stream: TransformStream<In, Out>,
  items: In[],
): Promise<boolean> => {
  if (stream.writable.locked) return false;

  const writer = stream.writable.getWriter();
  await writer.ready;

  if (!stream.readable.locked) return false;

  try {
    for (const item of items) {
      await writer.write(item);
    }
  } catch (error) {
    console.log(error);
  } finally {
    await writer.close();
  }
  return true;
};

export const writeToStreamAndStop = async <In, Out>(
  stream: TransformStream<In, Out>,
  items: In[],
): Promise<ReadableStream<Out>> => {
  await writeToStream(stream, items);
  return await noMoreWritingOn(stream);
};
