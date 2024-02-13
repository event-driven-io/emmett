import type { EventStore } from '../eventStore';
import type { Command, Event } from '../typing';
import type { Decider } from '../typing/decider';

// #region command-handler
export const DeciderCommandHandler =
  <
    State,
    CommandType extends Command,
    StreamEvent extends Event,
    NextExpectedVersion = bigint,
  >(
    {
      decide,
      evolve,
      getInitialState,
    }: Decider<State, CommandType, StreamEvent>,
    mapToStreamId: (id: string) => string,
  ) =>
  async (eventStore: EventStore, id: string, command: CommandType) => {
    const streamName = mapToStreamId(id);

    const { entity: state, nextExpectedVersion } =
      await eventStore.aggregateStream<State, StreamEvent, NextExpectedVersion>(
        streamName,
        {
          evolve,
          getInitialState,
        },
      );

    const result = decide(command, state ?? getInitialState());

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
