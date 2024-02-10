import type { Event } from '../typing';

export interface EventStore {
  aggregateStream<Entity, E extends Event>(
    streamName: string,
    options: {
      evolve: (currentState: Entity, event: E) => Entity;
      getInitialState: () => Entity;
    },
  ): Promise<Entity | null>;

  readStream<E extends Event>(streamName: string): Promise<E[]>;

  appendToStream<E extends Event, NextExpectedVersion = bigint>(
    streamId: string,
    ...events: E[]
  ): Promise<NextExpectedVersion>;
}
