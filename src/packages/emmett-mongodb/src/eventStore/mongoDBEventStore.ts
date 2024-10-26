import {
  ExpectedVersionConflictError,
  STREAM_DOES_NOT_EXIST,
  assertExpectedVersionMatchesCurrent,
  type EventStore,
  type Event,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type ReadStreamOptions,
  type ReadStreamResult,
  type ReadEventMetadata,
  type ExpectedStreamVersion,
} from '@event-driven-io/emmett';
import mongoose from 'mongoose';

export const MongoDBEventStoreDefaultStreamVersion = -1;

export type StreamType = string;
export type StreamName<T extends StreamType = StreamType> = `${T}:${string}`;

export type StreamNameParts<T extends StreamType = StreamType> = {
  streamType: T;
  entityId: string;
};

export type StreamToProject<EventType extends Event> = {
  streamName: StreamName;
  streamType: StreamType;
  entityId: string;
  streamVersion: number;
  events: EventType[];
};

export interface EventStream {
  _id: mongoose.ObjectId;
  streamName: string;
  events: Array<{
    _id: mongoose.ObjectId;
    type: string;
    data: string;
    metadata: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const eventStreamSchema = new mongoose.Schema(
  {
    streamName: {
      type: String,
      required: true,
    },
    events: {
      type: [
        {
          type: {
            type: String,
            required: true,
            enum: [],
          },
          data: {
            type: String,
            required: true,
          },
          metadata: {
            type: String,
            required: true,
          },
        },
      ],
      required: true,
      default: [],
    },
  },
  { timestamps: true },
);
eventStreamSchema.index({ streamName: 1 }, { unique: true });

class EventStoreClass implements EventStore<number> {
  private readonly Model: mongoose.Model<EventStream>;
  constructor(modelName: string) {
    this.Model =
      mongoose.models[modelName] ??
      mongoose.model<EventStream>(modelName, eventStreamSchema);
  }

  async readStream<EventType extends Event>(
    streamName: StreamName,
    options?: ReadStreamOptions<number>,
  ): Promise<Exclude<ReadStreamResult<EventType, number>, null>> {
    const expectedStreamVersion = options?.expectedStreamVersion;
    const stream = await this.Model.findOne({
      streamName: { $eq: streamName },
    });

    if (!stream) {
      return {
        events: [],
        currentStreamVersion: MongoDBEventStoreDefaultStreamVersion,
        streamExists: false,
      };
    }

    assertExpectedVersionMatchesCurrent(
      stream.events.length,
      expectedStreamVersion,
      MongoDBEventStoreDefaultStreamVersion,
    );

    const formattedEvents = stream.events
      .slice(0, maxEventIndex(expectedStreamVersion))
      .map(this.parseEvent<EventType>(streamName));

    return {
      events: formattedEvents,
      currentStreamVersion: stream.events.length,
      streamExists: true,
    };
  }

  async aggregateStream<State, EventType extends Event>(
    streamName: StreamName,
    options: AggregateStreamOptions<State, EventType, number>,
  ): Promise<AggregateStreamResult<State, number>> {
    const stream = await this.readStream<EventType>(streamName, options?.read);
    const state = stream.events.reduce(options.evolve, options.initialState());
    return {
      state,
      currentStreamVersion: stream.currentStreamVersion,
      streamExists: stream.streamExists,
    };
  }

  async appendToStream<EventType extends Event>(
    streamName: StreamName,
    events: EventType[],
    options?: AppendToStreamOptions<number> & {
      /**
       * This will be ran after a the events have been successfully appended to
       * the stream. `appendToStream` will return after the project is completed.
       */
      project?: (stream: StreamToProject<EventType>) => void | Promise<void>;
      /**
       * Same as `options.project` but this will run asynchronously.
       */
      projectAsync?: (
        stream: StreamToProject<EventType>,
      ) => void | Promise<void>;
    },
  ): Promise<AppendToStreamResult<number>> {
    const eventCreateInputs = events.map(this.stringifyEvent);

    let stream = await this.Model.findOne({
      streamName: { $eq: streamName },
    }).lean();
    let createdNewStream = false;

    if (!stream) {
      // @ts-expect-error
      stream = await this.Model.create({
        streamName,
        events: [],
      }).then((d) => d.toObject());
      createdNewStream = true;
    }

    // NOTE: should never happen, the `create` call will throw an error if it fails
    if (!stream) throw new Error('Failed to create stream');

    assertExpectedVersionMatchesCurrent(
      stream.events.length,
      options?.expectedStreamVersion,
      MongoDBEventStoreDefaultStreamVersion,
    );

    const updatedStream = await this.Model.findOneAndUpdate(
      {
        streamName: { $eq: streamName },
        events: { $size: stream.events.length },
      },
      { $push: { events: { $each: eventCreateInputs } } },
      { new: true },
    ).lean();

    if (!updatedStream) {
      const currentStream = await this.Model.findOne(
        { streamName: { $eq: streamName } },
        { events: true },
      ).lean();
      throw new ExpectedVersionConflictError(
        currentStream?.events.length ?? -1,
        stream.events.length,
      );
    }

    const { streamType, entityId } = fromStreamName(streamName);
    if (options?.project) {
      await options.project({
        streamName,
        streamType,
        entityId,
        streamVersion: updatedStream.events.length,
        events: updatedStream.events.map(this.parseEvent(streamName)),
      });
    }

    if (options?.projectAsync) {
      options.projectAsync({
        streamName,
        streamType,
        entityId,
        streamVersion: updatedStream.events.length,
        events: updatedStream.events.map(this.parseEvent(streamName)),
      });
    }

    return {
      nextExpectedStreamVersion: updatedStream.events.length,
      createdNewStream,
    };
  }

  /**
   * Transforms the `event` from the saved format into the usable object
   * at runtime. This function may be altered later to match `stringifyEvent`.
   */
  private parseEvent<EventType extends Event>(streamName: StreamName) {
    return (
      event: EventStream['events'][number],
      index?: number,
    ): EventType => {
      const metadata = {
        ...JSON.parse(event.metadata),
        eventId: event._id,
        streamName,
        streamPosition: BigInt(index ?? 0),
      } satisfies ReadEventMetadata;
      return {
        __brand: 'Event',
        type: event.type,
        data: JSON.parse(event.data),
        metadata,
      } as EventType;
    };
  }

  /**
   * Transforms the `event` into a saveable format. This function may
   * be altered later depending on storage needs.
   */
  private stringifyEvent<EventType extends Event>(
    event: EventType,
  ): Omit<EventStream['events'][number], '_id'> {
    return {
      type: event.type,
      data: JSON.stringify(event.data),
      metadata: JSON.stringify(
        event.metadata ?? {
          now: new Date(),
        },
      ),
    };
  }
}

export const getMongoDBEventStore = (modelName: string) => {
  const eventStore = new EventStoreClass(modelName);
  return eventStore;
};

function maxEventIndex(
  expectedStreamVersion?: ExpectedStreamVersion<number>,
): number | undefined {
  if (!expectedStreamVersion) return undefined;

  if (typeof expectedStreamVersion === 'number') {
    return expectedStreamVersion;
  }

  switch (expectedStreamVersion) {
    case STREAM_DOES_NOT_EXIST:
      return 0;
    default:
      return undefined;
  }
}

/**
 * Accepts a `streamType` (the type/category of the event stream) and an `entityId`
 * (the individual entity/object or aggregate ID) and combines them to a singular
 * `streamName` which can be used in `EventStore`.
 */
export function toStreamName<T extends StreamType>(
  streamType: T,
  entityId: string,
): StreamName<T> {
  return `${streamType}:${entityId}`;
}

/**
 * Accepts a fully formatted `streamName` and returns the broken down
 * `streamType` and `entityId`.
 */
export function fromStreamName<T extends StreamType>(
  streamName: StreamName<T>,
): StreamNameParts<T> {
  const parts = streamName.split(':') as [T, string];
  return {
    streamType: parts[0],
    entityId: parts[1],
  };
}
