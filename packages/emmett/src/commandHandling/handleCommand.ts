import type { EventStore } from '../eventStore';
import type { Event } from '../typing';

// #region command-handler
export const CommandHandler =
  <State, StreamEvent extends Event, NextExpectedVersion = bigint>(
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

    const { entity: state, nextExpectedVersion } =
      await eventStore.aggregateStream<State, StreamEvent, NextExpectedVersion>(
        streamName,
        {
          evolve,
          getInitialState,
        },
      );

    const result = handle(state ?? getInitialState());

    if (Array.isArray(result))
      return eventStore.appendToStream(
        streamName,
        nextExpectedVersion,
        ...result,
      );
    else
      return eventStore.appendToStream(streamName, nextExpectedVersion, result);
  };
// #endregion command-handler
