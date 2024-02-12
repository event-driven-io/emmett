import type { EventStore } from '../eventStore';
import type { Command, Event } from '../typing';
import type { Decider } from '../typing/decider';

// #region command-handler
export const DeciderCommandHandler =
  <State, CommandType extends Command, StreamEvent extends Event>(
    {
      decide,
      evolve,
      getInitialState,
    }: Decider<State, CommandType, StreamEvent>,
    mapToStreamId: (id: string) => string,
  ) =>
  async (eventStore: EventStore, id: string, command: CommandType) => {
    const streamName = mapToStreamId(id);

    const state = await eventStore.aggregateStream(streamName, {
      evolve,
      getInitialState,
    });

    const result = decide(command, state ?? getInitialState());

    if (Array.isArray(result))
      return eventStore.appendToStream(streamName, ...result);
    else return eventStore.appendToStream(streamName, result);
  };
// #endregion command-handler
