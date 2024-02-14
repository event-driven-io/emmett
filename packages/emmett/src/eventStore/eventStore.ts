import type { Event, Flavour } from '../typing';

// #region event-store
export interface EventStore<StreamVersion = DefaultStreamVersionType> {
  aggregateStream<State, EventType extends Event>(
    streamName: string,
    options: AggregateStreamOptions<State, EventType, StreamVersion>,
  ): Promise<AggregateStreamResult<State, StreamVersion>>;

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

export type ReadStreamOptions<StreamVersion = bigint> = (
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

export type ReadStreamResult<E extends Event, StreamVersion = bigint> = {
  currentStreamVersion: StreamVersion;
  events: E[];
} | null;

////////////////////////////////////////////////////////////////////
/// AggregateStream types
////////////////////////////////////////////////////////////////////

export type AggregateStreamOptions<
  State,
  E extends Event,
  StreamVersion = bigint,
> = {
  evolve: (currentState: State, event: E) => State;
  getInitialState: () => State;
  read?: ReadStreamOptions<StreamVersion>;
};

export type AggregateStreamResult<State, StreamVersion = bigint> = {
  currentStreamVersion: StreamVersion | null;
  state: State | null;
};

////////////////////////////////////////////////////////////////////
/// AppendToStream types
////////////////////////////////////////////////////////////////////

export type AppendToStreamOptions<StreamVersion = bigint> = {
  expectedStreamVersion?: ExpectedStreamVersion<StreamVersion>;
};

export type AppendToStreamResult<StreamVersion = bigint> = {
  nextExpectedStreamVersion: StreamVersion;
} | null;

export type ExpectedStreamVersion<VersionType = DefaultStreamVersionType> =
  | ExpectedStreamVersionWithValue<VersionType>
  | ExpectedStreamVersionGeneral;

export type ExpectedStreamVersionWithValue<
  VersionType = DefaultStreamVersionType,
> = Flavour<VersionType, 'StreamVersion'>;

export type ExpectedStreamVersionGeneral = Flavour<
  'STREAM_EXISTS' | 'STREAM_DOES_NOT_EXISTS' | 'NO_CHECK',
  'StreamVersion'
>;

export const STREAM_EXISTS = 'STREAM_EXISTS' as ExpectedStreamVersionGeneral;
export const STREAM_DOES_NOT_EXISTS =
  'STREAM_DOES_NOT_EXISTS' as ExpectedStreamVersionGeneral;
export const NO_CHECK = 'NO_CHECK' as ExpectedStreamVersionGeneral;
