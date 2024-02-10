import type { EventStore } from '../eventStore';
import type { Event } from '../typing';

export const CommandHandler =
  <State, StreamEvent extends Event>(
    evolve: (state: State, event: StreamEvent) => State,
    getInitialState: () => State,
    mapToStreamId: (id: string) => string,
  ) =>
  async (
    eventStore: EventStore,
    id: string,
    handle: (state: State) => StreamEvent | StreamEvent[],
  ) => {
    const streamName = mapToStreamId(id);

    const state = await eventStore.aggregateStream(streamName, {
      evolve,
      getInitialState,
    });

    const result = handle(state ?? getInitialState());

    if (Array.isArray(result))
      return eventStore.appendToStream(streamName, ...result);
    else return eventStore.appendToStream(streamName, result);
  };
