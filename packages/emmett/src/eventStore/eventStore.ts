import type { Event } from '../typing';
import type { ExpectedStreamVersion } from './expectedVersion';

// #region event-store
export interface EventStore<StreamVersion = DefaultStreamVersionType> {
  aggregateStream<State, EventType extends Event>(
    streamName: string,
    options: AggregateStreamOptions<State, EventType, StreamVersion>,
  ): Promise<AggregateStreamResult<State, StreamVersion> | null>;

  readStream<EventType extends Event>(
    streamName: string,
    options?: ReadStreamOptions<StreamVersion>,
  ): Promise<ReadStreamResult<EventType, StreamVersion>>;

  appendToStream<EventType extends Event>(
    streamId: string,
    events: EventType[],
    options?: AppendToStreamOptions<StreamVersion>,
  ): Promise<AppendToStreamResult<StreamVersion>>;
}

export type DefaultStreamVersionType = bigint;
// #endregion event-store

////////////////////////////////////////////////////////////////////
/// ReadStream types
////////////////////////////////////////////////////////////////////

export type ReadStreamOptions<StreamVersion = DefaultStreamVersionType> = (
  | {
      from: StreamVersion;
    }
  | { to: StreamVersion }
  | { from: StreamVersion; maxCount?: bigint }
  | {
      expectedStreamVersion: ExpectedStreamVersion<StreamVersion>;
    }
) & {
  expectedStreamVersion?: ExpectedStreamVersion<StreamVersion>;
};

export type ReadStreamResult<
  E extends Event,
  StreamVersion = DefaultStreamVersionType,
> = {
  currentStreamVersion: StreamVersion;
  events: E[];
} | null;

////////////////////////////////////////////////////////////////////
/// AggregateStream types
////////////////////////////////////////////////////////////////////

export type AggregateStreamOptions<
  State,
  E extends Event,
  StreamVersion = DefaultStreamVersionType,
> = {
  evolve: (currentState: State, event: E) => State;
  getInitialState: () => State;
  read?: ReadStreamOptions<StreamVersion>;
};

export type AggregateStreamResult<
  State,
  StreamVersion = DefaultStreamVersionType,
> = {
  currentStreamVersion: StreamVersion;
  state: State;
};

////////////////////////////////////////////////////////////////////
/// AppendToStream types
////////////////////////////////////////////////////////////////////

export type AppendToStreamOptions<StreamVersion = DefaultStreamVersionType> = {
  expectedStreamVersion?: ExpectedStreamVersion<StreamVersion>;
};

export type AppendToStreamResult<StreamVersion = DefaultStreamVersionType> = {
  nextExpectedStreamVersion: StreamVersion;
} | null;
