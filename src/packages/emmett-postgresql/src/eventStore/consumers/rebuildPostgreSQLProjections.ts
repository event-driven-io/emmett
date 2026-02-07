import {
  getProjectorId,
  unknownTag,
  type AnyEvent,
  type ProjectorOptions,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { PostgreSQLProjectionDefinition } from '../projections';
import type { LockAcquisitionPolicy } from '../projections/locks';
import {
  postgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumerOptions,
} from './postgreSQLEventStoreConsumer';
import type { PostgreSQLProcessorHandlerContext } from './postgreSQLProcessor';

const defaultRebuildLockPolicy: LockAcquisitionPolicy = {
  type: 'retry',
  retries: 100,
  minTimeout: 100,
  maxTimeout: 5000,
};

export const rebuildPostgreSQLProjections = <
  EventType extends AnyEvent = AnyEvent,
>(
  options: Omit<
    PostgreSQLEventStoreConsumerOptions<EventType>,
    'stopWhen' | 'processors'
  > & { lockPolicy?: LockAcquisitionPolicy } & (
      | {
          projections: (
            | ProjectorOptions<
                EventType,
                ReadEventMetadataWithGlobalPosition,
                PostgreSQLProcessorHandlerContext
              >
            | PostgreSQLProjectionDefinition<EventType>
          )[];
        }
      | ProjectorOptions<
          EventType,
          ReadEventMetadataWithGlobalPosition,
          PostgreSQLProcessorHandlerContext
        >
    ),
): PostgreSQLEventStoreConsumer<EventType> => {
  const consumer = postgreSQLEventStoreConsumer({
    ...options,
    stopWhen: { noMessagesLeft: true },
  });

  const projections: (Omit<
    ProjectorOptions<
      EventType,
      ReadEventMetadataWithGlobalPosition,
      PostgreSQLProcessorHandlerContext
    >,
    'processorId'
  > & { processorId?: string })[] =
    'projections' in options
      ? options.projections.map((p) =>
          'projection' in p
            ? {
                lockPolicy: defaultRebuildLockPolicy,
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
                lockPolicy: defaultRebuildLockPolicy,
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
