import type { Event } from '@event-driven-io/emmett';
import type { PostgresEventStore } from '..';
import type { MessageBatchAppender } from './loadTestGenerator';

export type { MessageBatchAppender };

export const postgresEventStoreAppender = (
  store: PostgresEventStore,
): MessageBatchAppender => ({
  append: ({ streamName, events }) =>
    store.appendToStream(streamName, events as Event[]).then(() => undefined),
});
