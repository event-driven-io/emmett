import {
  assertEqual,
  assertFails,
  assertMatches,
  type DefaultStreamVersionType,
  type Event,
  type EventStore,
} from '@event-driven-io/emmett';
import { type Application } from 'express';
import type { ProblemDocument } from 'http-problem-details';
import type { Response, Test } from 'supertest';
import supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { WrapEventStore, type TestEventStream } from './utils';

////////////////////////////////
/////////// Setup
////////////////////////////////

export type TestRequest = (request: TestAgent<supertest.Test>) => Test;

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
  <Body = unknown>(
    statusCode: number,
    options?: { body?: Body; headers?: { [index: string]: string } },
  ) =>
  (response: Response): void => {
    const { body, headers } = options ?? {};
    assertEqual(response.statusCode, statusCode);
    if (body) assertMatches(response.body, body);
    if (headers) assertMatches(response.headers, headers);
  };

export const expectError = (
  errorCode: number,
  problemDetails?: Partial<ProblemDocument>,
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
  when: (setupRequest: TestRequest) => {
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
          when: (setupRequest: TestRequest) => {
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
                  const succeeded = verify(response);

                  if (succeeded === false) assertFails();
                } else if (Array.isArray(verify)) {
                  const [first, ...rest] = verify;

                  if (typeof first === 'function') {
                    const succeeded = first(response);

                    if (succeeded === false) assertFails();
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
