import {
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  type AppendToStreamResult,
  type DefaultStreamVersionType,
  type EventStore,
  type ExpectedStreamVersion,
} from '../eventStore';
import type { Event } from '../typing';

// #region command-handler
export type CommandHandlerResult<
  State,
  StreamVersion = DefaultStreamVersionType,
> = AppendToStreamResult<StreamVersion> & { newState: State };

export const CommandHandler =
  <State, StreamEvent extends Event, StreamVersion = DefaultStreamVersionType>(
    evolve: (state: State, event: StreamEvent) => State,
    getInitialState: () => State,
    mapToStreamId: (id: string) => string = (id) => id,
  ) =>
  async (
    eventStore: EventStore<StreamVersion>,
    id: string,
    handle: (state: State) => StreamEvent | StreamEvent[],
    options?: {
      expectedStreamVersion?: ExpectedStreamVersion<StreamVersion>;
    },
  ): Promise<CommandHandlerResult<State, StreamVersion>> => {
    const streamName = mapToStreamId(id);

    // 1. Aggregate the stream
    const aggregationResult = await eventStore.aggregateStream<
      State,
      StreamEvent
    >(streamName, {
      evolve,
      getInitialState,
      read: {
        // expected stream version is passed to fail fast
        // if stream is in the wrong state
        expectedStreamVersion:
          options?.expectedStreamVersion ?? NO_CONCURRENCY_CHECK,
      },
    });

    // 2. Use the aggregate state or the initial one (when e.g. stream does not exist)
    const state = aggregationResult?.state ?? getInitialState();
    const currentStreamVersion = aggregationResult?.currentStreamVersion;

    // 3. Run business logic
    const result = handle(state);

    const newEvents = Array.isArray(result) ? result : [result];

    // Either use:
    // - provided expected stream version,
    // - current stream version got from stream aggregation,
    // - or expect stream not to exists otherwise.
    const expectedStreamVersion: ExpectedStreamVersion<StreamVersion> =
      options?.expectedStreamVersion ??
      currentStreamVersion ??
      STREAM_DOES_NOT_EXIST;

    // 4. Append result to the stream
    const appendResult = await eventStore.appendToStream(
      streamName,
      newEvents,
      {
        expectedStreamVersion,
      },
    );

    // 5. Return result with updated state
    return { ...appendResult, newState: newEvents.reduce(evolve, state) };
  };
// #endregion command-handler
