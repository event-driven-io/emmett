import {
  getProjectorId,
  unknownTag,
  type AnyEvent,
  type ProjectorOptions,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { AnySQLiteEventStoreDriver } from '../eventStoreDriver';
import type { SQLiteProjectionDefinition } from '../projections';
import {
  sqliteEventStoreConsumer,
  type SQLiteEventStoreConsumer,
  type SQLiteEventStoreConsumerConfig,
  type SQLiteEventStoreConsumerConnectionOptions,
} from './sqliteEventStoreConsumer';
import type { SQLiteProcessorHandlerContext } from './sqliteProcessor';

export type RebuildSQLiteProjectionsOptions<
  EventType extends AnyEvent = AnyEvent,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = Omit<SQLiteEventStoreConsumerConfig<EventType>, 'stopWhen' | 'processors'> &
  SQLiteEventStoreConsumerConnectionOptions<EventType, Driver> &
  (
    | {
        projections: (
          | ProjectorOptions<
              EventType,
              ReadEventMetadataWithGlobalPosition,
              SQLiteProcessorHandlerContext<Driver>
            >
          | SQLiteProjectionDefinition<EventType, EventType, Driver>
        )[];
      }
    | ProjectorOptions<
        EventType,
        ReadEventMetadataWithGlobalPosition,
        SQLiteProcessorHandlerContext<Driver>
      >
  );

export const rebuildSQLiteProjections = <
  EventType extends AnyEvent = AnyEvent,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  options: RebuildSQLiteProjectionsOptions<EventType, Driver>,
): SQLiteEventStoreConsumer<EventType, Driver> => {
  const consumer = sqliteEventStoreConsumer<EventType, Driver>({
    ...options,
    stopWhen: { noMessagesLeft: true },
  });

  const projections: (Omit<
    ProjectorOptions<
      EventType,
      ReadEventMetadataWithGlobalPosition,
      SQLiteProcessorHandlerContext<Driver>
    >,
    'processorId'
  > & { processorId?: string })[] =
    'projections' in options
      ? options.projections.map((p) =>
          'projection' in p
            ? {
                truncateOnStart: true,
                processorId: getProjectorId({
                  projectionName: p.projection.name ?? unknownTag,
                }),
                ...p,
              }
            : {
                projection: p,
                processorId: getProjectorId({
                  projectionName: p.name ?? unknownTag,
                }),
                truncateOnStart: true,
              },
        )
      : [options];

  for (const projectionDefinition of projections) {
    consumer.projector({
      ...projectionDefinition,
      truncateOnStart: projectionDefinition.truncateOnStart ?? true,
    });
  }

  return consumer;
};
