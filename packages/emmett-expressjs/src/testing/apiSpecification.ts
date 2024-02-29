import {
  assertMatches,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type DefaultStreamVersionType,
  type Event,
  type EventStore,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import { type Application } from 'express';
import type { ProblemDocument } from 'http-problem-details';
import assert from 'node:assert/strict';
import type { Response, Test } from 'supertest';
import supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';

////////////////////////////////
/////////// Setup
////////////////////////////////

export type TestEventStream<EventType extends Event = Event> = [
  string,
  EventType[],
];

export const existingStream = <EventType extends Event = Event>(
  streamId: string,
  events: EventType[],
): TestEventStream<EventType> => {
  return [streamId, events];
};

////////////////////////////////
/////////// Asserts
////////////////////////////////

export type ResponseAssert = (response: Response) => boolean | void;

export type ApiSpecificationAssert<EventType extends Event = Event> =
  | TestEventStream<EventType>[]
  | ResponseAssert
  | [ResponseAssert, ...TestEventStream<EventType>[]];

export const expect = <EventType extends Event = Event>(
  streamId: string,
  events: EventType[],
): TestEventStream<EventType> => {
  return [streamId, events];
};

export const expectNewEvents = <EventType extends Event = Event>(
  streamId: string,
  events: EventType[],
): TestEventStream<EventType> => {
  return [streamId, events];
};

export const expectResponse =
  (
    statusCode: number,
    options?: { body?: unknown; headers?: { [index: string]: string } },
  ) =>
  (response: Response): void => {
    const { body, headers } = options ?? {};
    assert.equal(response.statusCode, statusCode);
    if (body) assertMatches(response.body, body);
    if (headers) assertMatches(response.headers, headers);
  };

export const expectError = (
  errorCode: number,
  problemDetails?: ProblemDocument,
) =>
  expectResponse(
    errorCode,
    problemDetails ? { body: problemDetails } : undefined,
  );

////////////////////////////////
/////////// Api Specification
////////////////////////////////

export type ApiSpecification<EventType extends Event = Event> = (
  ...givenStreams: TestEventStream<EventType>[]
) => {
  when: (setupRequest: (request: TestAgent<supertest.Test>) => Test) => {
    then: (verify: ApiSpecificationAssert<EventType>) => Promise<void>;
  };
};

export const ApiSpecification = {
  for: <
    EventType extends Event = Event,
    StreamVersion = DefaultStreamVersionType,
  >(
    getEventStore: () => EventStore<StreamVersion>,
    getApplication: (eventStore: EventStore<StreamVersion>) => Application,
  ): ApiSpecification<EventType> => {
    {
      return (...givenStreams: TestEventStream<EventType>[]) => {
        const eventStore = WrapEventStore(getEventStore());
        const application = getApplication(eventStore);

        return {
          when: (
            setupRequest: (request: TestAgent<supertest.Test>) => Test,
          ) => {
            const handle = async () => {
              for (const [streamName, events] of givenStreams) {
                await eventStore.setup(streamName, events);
              }

              return setupRequest(supertest(application));
            };

            return {
              then: async (
                verify: ApiSpecificationAssert<EventType>,
              ): Promise<void> => {
                const response = await handle();

                if (typeof verify === 'function') {
                  const succeded = verify(response);

                  if (succeded === false) assert.fail();
                } else if (Array.isArray(verify)) {
                  const [first, ...rest] = verify;

                  if (typeof first === 'function') {
                    const succeded = first(response);

                    if (succeded === false) assert.fail();
                  }

                  const events = typeof first === 'function' ? rest : verify;

                  assertMatches(
                    Array.from(eventStore.appendedEvents.values()),
                    events,
                  );
                }
              },
            };
          },
        };
      };
    }
  },
};

const WrapEventStore = <StreamVersion = DefaultStreamVersionType>(
  eventStore: EventStore<StreamVersion>,
): EventStore<StreamVersion> & {
  appendedEvents: Map<string, TestEventStream>;
  setup<EventType extends Event>(
    streamName: string,
    events: EventType[],
  ): Promise<AppendToStreamResult<StreamVersion>>;
} => {
  const appendedEvents = new Map<string, TestEventStream>();

  return {
    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<State, EventType, StreamVersion>,
    ): Promise<AggregateStreamResult<State, StreamVersion> | null> {
      return eventStore.aggregateStream(streamName, options);
    },

    readStream<EventType extends Event>(
      streamName: string,
      options?: ReadStreamOptions<StreamVersion>,
    ): Promise<ReadStreamResult<EventType, StreamVersion>> {
      return eventStore.readStream(streamName, options);
    },

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions<StreamVersion>,
    ): Promise<AppendToStreamResult<StreamVersion>> => {
      const result = await eventStore.appendToStream(
        streamName,
        events,
        options,
      );

      const currentStream = appendedEvents.get(streamName) ?? [streamName, []];

      appendedEvents.set(streamName, [
        streamName,
        [...currentStream[1], ...events],
      ]);

      return result;
    },

    appendedEvents,

    setup: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
    ): Promise<AppendToStreamResult<StreamVersion>> => {
      return eventStore.appendToStream(streamName, events);
    },
  };
};
