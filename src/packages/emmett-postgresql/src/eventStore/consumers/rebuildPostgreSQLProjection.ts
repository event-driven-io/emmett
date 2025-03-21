import type {
  AnyEvent,
  ProjectorOptions,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett/src';
import { v7 as uuid } from 'uuid';
import {
  postgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumerOptions,
} from './postgreSQLEventStoreConsumer';
import type { PostgreSQLProcessorHandlerContext } from './postgreSQLProcessor';

export const rebuildPostgreSQLProjection = <
  EventType extends AnyEvent = AnyEvent,
>(
  options: Omit<PostgreSQLEventStoreConsumerOptions<EventType>, 'stopWhen'> &
    Omit<
      ProjectorOptions<
        EventType,
        ReadEventMetadataWithGlobalPosition,
        PostgreSQLProcessorHandlerContext
      >,
      'processorId'
    > & { processorId?: string },
): PostgreSQLEventStoreConsumer<EventType> => {
  const consumer = postgreSQLEventStoreConsumer({
    ...options,
    stopWhen: { noMessagesLeft: true },
  });

  consumer.processor({
    ...options,
    processorId:
      options.processorId ??
      `projection:${options.projection.name ?? uuid()}-rebuild`,
    truncateOnStart: options.truncateOnStart ?? true,
  });

  return consumer;
};
