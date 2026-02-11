import type { AnyMessage, Message } from '@event-driven-io/emmett';
import {
  type Checkpointer,
  type ReadEventMetadataWithGlobalPosition,
  getCheckpoint,
} from '@event-driven-io/emmett';
import { readProcessorCheckpoint, storeProcessorCheckpoint } from '../schema';
import type { SQLiteProcessorHandlerContext } from './sqliteProcessor';

export type SQLiteCheckpointer<MessageType extends AnyMessage = AnyMessage> =
  Checkpointer<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    SQLiteProcessorHandlerContext
  >;

export const sqliteCheckpointer = <
  MessageType extends Message = Message,
>(): SQLiteCheckpointer<MessageType> => ({
  read: async (options, context) => {
    const result = await readProcessorCheckpoint(context.execute, options);

    return { lastCheckpoint: result?.lastProcessedCheckpoint };
  },
  store: async (options, context) => {
    const newCheckpoint = getCheckpoint(options.message);

    const result = await storeProcessorCheckpoint(context.execute, {
      lastProcessedCheckpoint: options.lastCheckpoint,
      newCheckpoint,
      processorId: options.processorId,
      partition: options.partition,
      version: options.version,
    });

    return result.success
      ? { success: true, newCheckpoint: result.newCheckpoint }
      : result;
  },
});
