import type { Event } from '../typing';

// #region event-store
export interface EventStore {
  aggregateStream<Entity, E extends Event, NextExpectedVersion = bigint>(
    streamName: string,
    options: {
      evolve: (currentState: Entity, event: E) => Entity;
      getInitialState: () => Entity;
      startingVersion?: NextExpectedVersion | undefined;
    },
  ): Promise<{
    entity: Entity | null;
    nextExpectedVersion: NextExpectedVersion;
  }>;

  readStream<E extends Event, NextExpectedVersion = bigint>(
    streamName: string,
    startingVersion?: NextExpectedVersion | undefined,
  ): Promise<E[]>;

  appendToStream<E extends Event, NextExpectedVersion = bigint>(
    streamId: string,
    expectedVersion?: NextExpectedVersion | undefined,
    ...events: E[]
  ): Promise<NextExpectedVersion>;
}
// #endregion event-store
