import type { Event, EventStore, Flavour } from '@event-driven-io/emmett';
import { type Application } from 'express';
import assert from 'node:assert/strict';
import type { Response, Test } from 'supertest';
import supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';

export type TestEventStream<EventType extends Event = Event> = {
  streamName: string;
  events: EventType[];
};

export type ApiSpecification<EventType extends Event = Event> = (
  givenStreams: TestEventStream<EventType>[],
) => {
  when: (setupRequest: (request: TestAgent<supertest.Test>) => Test) => {
    then: (verify: ApiSpecificationAssert<EventType>) => Promise<void>;
  };
};

export type ApiSpecificationAssert<EventType extends Event = Event> =
  | Flavour<TestEventStream<EventType>[], 'appendedEvents'>
  | Flavour<(response: Response) => boolean, 'responseAssert'>
  | Flavour<
      {
        events: TestEventStream<EventType>[];
        responseMatches: (response: Response) => boolean;
      },
      'fullAssert'
    >;

export const ApiSpecification = {
  for: <EventType extends Event = Event>(
    getEventStore: () => EventStore,
    getApplication: (eventStore: EventStore) => Application,
  ): ApiSpecification<EventType> => {
    {
      return (givenStreams: TestEventStream<EventType>[]) => {
        return {
          when: (
            setupRequest: (request: TestAgent<supertest.Test>) => Test,
          ) => {
            const handle = async () => {
              const eventStore = getEventStore();
              const application = getApplication(eventStore);

              for (const { streamName, events } of givenStreams) {
                await eventStore.appendToStream(streamName, events);
              }

              return setupRequest(supertest(application));
            };

            return {
              then: async (
                verify: ApiSpecificationAssert<EventType>,
              ): Promise<void> => {
                const response = await handle();

                if (verify.__brand === 'responseAssert') {
                  assert.ok(verify(response));
                } else if (verify.__brand === 'fullAssert') {
                  assert.ok(verify.responseMatches(response));
                }
              },
            };
          },
        };
      };
    }
  },
};
