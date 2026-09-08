import {
  getProjectorId,
  unknownTag,
  type AnyEvent,
  type ProjectorOptions,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { PgEventStoreDriver } from '../../pg';
import type { AnyPostgreSQLEventStoreDriver } from '../eventStoreDriver';
import type { PostgreSQLProjectionDefinition } from '../projections';
import type { LockAcquisitionPolicy } from '../projections/locks';
import {
  postgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumerConfig,
  type PostgreSQLEventStoreConsumerConnectionOptions,
} from './postgreSQLEventStoreConsumer';
import type { PostgreSQLProcessorHandlerContext } from './postgreSQLProcessor';

const defaultRebuildLockPolicy: LockAcquisitionPolicy = {
  type: 'retry',
  retries: 100,
  minTimeout: 100,
  maxTimeout: 5000,
};

export type RebuildPostgreSQLProjectionsOptions<
  EventType extends AnyEvent = AnyEvent,
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
> = Omit<
  PostgreSQLEventStoreConsumerConfig<EventType>,
  'stopWhen' | 'processors'
> &
  PostgreSQLEventStoreConsumerConnectionOptions<EventType, Driver> & {
    lock?: {
      acquisitionPolicy?: LockAcquisitionPolicy;
      timeoutSeconds?: number;
    };
  } & (
    | {
        projections: (
          | ProjectorOptions<
              EventType,
              ReadEventMetadataWithGlobalPosition,
              PostgreSQLProcessorHandlerContext<Driver>
            >
          | PostgreSQLProjectionDefinition<EventType, EventType, Driver>
        )[];
      }
    | ProjectorOptions<
        EventType,
        ReadEventMetadataWithGlobalPosition,
        PostgreSQLProcessorHandlerContext<Driver>
      >
  );

export const rebuildPostgreSQLProjections = <
  EventType extends AnyEvent = AnyEvent,
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
>(
  options: RebuildPostgreSQLProjectionsOptions<EventType, Driver>,
): PostgreSQLEventStoreConsumer<EventType, Driver> => {
  const consumer = postgreSQLEventStoreConsumer<EventType, Driver>({
    ...options,
    stopWhen: { noMessagesLeft: true },
  });

  const lock = { acquisitionPolicy: defaultRebuildLockPolicy, ...options.lock };

  const projections: (Omit<
    ProjectorOptions<
      EventType,
      ReadEventMetadataWithGlobalPosition,
      PostgreSQLProcessorHandlerContext<Driver>
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
      lock,
    });
  }

  return consumer;
};
