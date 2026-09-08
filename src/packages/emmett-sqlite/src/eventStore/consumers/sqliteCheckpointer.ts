import type { AnyMessage, Message } from '@event-driven-io/emmett';
import {
  type Checkpointer,
  type ReadEventMetadataWithGlobalPosition,
  getCheckpoint,
} from '@event-driven-io/emmett';
import type { AnySQLiteEventStoreDriver } from '../eventStoreDriver';
import { readProcessorCheckpoint, storeProcessorCheckpoint } from '../schema';
import type { SQLiteProcessorHandlerContext } from './sqliteProcessor';

export type SQLiteCheckpointer<
  MessageType extends AnyMessage = AnyMessage,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = Checkpointer<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  SQLiteProcessorHandlerContext<Driver>
>;

export const sqliteCheckpointer = <
  MessageType extends Message = Message,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(): SQLiteCheckpointer<MessageType, Driver> => ({
  read: async (options, context) => {
    const result = await readProcessorCheckpoint(context.execute, {
      ...options,
      databaseSchemaName: context.migrationOptions?.databaseSchemaName,
    });

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
      databaseSchemaName: context.migrationOptions?.databaseSchemaName,
    });

    return result.success
      ? { success: true, newCheckpoint: result.newCheckpoint }
      : result;
  },
});
