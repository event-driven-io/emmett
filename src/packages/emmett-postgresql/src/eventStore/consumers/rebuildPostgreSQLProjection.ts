import type {
  AnyEvent,
  ProjectorOptions,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett/src';
import { v7 as uuid } from 'uuid';
import type { PostgreSQLProjectionDefinition } from '../projections';
import {
  postgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumerOptions,
} from './postgreSQLEventStoreConsumer';
import type { PostgreSQLProcessorHandlerContext } from './postgreSQLProcessor';

export const rebuildPostgreSQLProjection = <
  EventType extends AnyEvent = AnyEvent,
>(
  options: Omit<
    PostgreSQLEventStoreConsumerOptions<EventType>,
    'stopWhen' | 'processors'
  > &
    (
      | {
          projections: (
            | (Omit<
                ProjectorOptions<
                  EventType,
                  ReadEventMetadataWithGlobalPosition,
                  PostgreSQLProcessorHandlerContext
                >,
                'processorId'
              > & { processorId?: string })
            | PostgreSQLProjectionDefinition<EventType>
          )[];
        }
      | (Omit<
          ProjectorOptions<
            EventType,
            ReadEventMetadataWithGlobalPosition,
            PostgreSQLProcessorHandlerContext
          >,
          'processorId'
        > & { processorId?: string })
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
                processorId: `projection:${p.projection.name ?? uuid()}-rebuild`,
                truncateOnStart: true,
              }
            : {
                projection: p,
                processorId: `projection:${p.name ?? uuid()}-rebuild`,
                truncateOnStart: true,
              },
        )
      : [options];

  for (const projectionDefinition of projections) {
    consumer.processor({
      ...projectionDefinition,
      processorId:
        projectionDefinition.processorId ??
        `projection:${projectionDefinition.projection.name ?? uuid()}-rebuild`,
      truncateOnStart: projectionDefinition.truncateOnStart ?? true,
    });
  }

  return consumer;
};
