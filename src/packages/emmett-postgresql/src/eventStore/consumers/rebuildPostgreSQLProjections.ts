import type {
  AnyEvent,
  ProjectorOptions,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { PostgreSQLProjectionDefinition } from '../projections';
import {
  postgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumerOptions,
} from './postgreSQLEventStoreConsumer';
import type { PostgreSQLProcessorHandlerContext } from './postgreSQLProcessor';

export const rebuildPostgreSQLProjections = <
  EventType extends AnyEvent = AnyEvent,
>(
  options: Omit<
    PostgreSQLEventStoreConsumerOptions<EventType>,
    'stopWhen' | 'processors'
  > &
    (
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
                ...p,
                processorId: `emt:processor:projector:${p.projection.name}`,
                truncateOnStart: p.truncateOnStart ?? true,
              }
            : {
                projection: p,
                processorId: `emt:processor:projector:${p.name}`,
                truncateOnStart: true,
              },
        )
      : [options];

  for (const projectionDefinition of projections) {
    consumer.projector({
      ...projectionDefinition,
      processorId:
        projectionDefinition.processorId ??
        `projection:${projectionDefinition.projection.name}`,
      truncateOnStart: projectionDefinition.truncateOnStart ?? true,
    });
  }

  return consumer;
};
