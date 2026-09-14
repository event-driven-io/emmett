import {
  WrapEventStore,
  assertEqual,
  assertFails,
  assertMatches,
  getInMemoryEventStore,
  type Event,
  type EventStore,
  type InMemoryEventStore,
  type TestEventStream,
} from '@event-driven-io/emmett';
import type { Application } from 'express';
import type { ProblemDocument } from 'http-problem-details';
import type { Response as SuperTestResponse, Test } from 'supertest';
import supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import {
  executeFetchRequest,
  type Fetch,
  type FetchResponseAssert,
  type FetchTestRequestSetup,
  type FetchTestResponse,
} from './fetchTestClient';

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

export type ResponseAssert = (
  response: SuperTestResponse,
) => boolean | void | Promise<boolean> | Promise<void>;

type TestResponse = Readonly<{
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}>;

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
  (response: TestResponse): void => {
    const { body, headers } = options ?? {};
    assertEqual(statusCode, response.statusCode, "Response code doesn't match");
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

type FetchApiSpecificationAssert<EventType extends Event = Event> =
  | TestEventStream<EventType>[]
  | FetchResponseAssert
  | [FetchResponseAssert, ...TestEventStream<EventType>[]];

type FetchApiSpecification<EventType extends Event = Event> = (
  ...givenStreams: TestEventStream<EventType>[]
) => {
  when: (setupRequest: FetchTestRequestSetup) => {
    then: (verify: FetchApiSpecificationAssert<EventType>) => Promise<void>;
  };
};

function apiSpecificationFor<
  EventType extends Event = Event,
  Store extends EventStore = InMemoryEventStore,
>(options: {
  getEventStore?: () => Store;
  fetch: Fetch;
  getApplication?: never;
}): FetchApiSpecification<EventType>;

function apiSpecificationFor<
  EventType extends Event = Event,
  Store extends EventStore = InMemoryEventStore,
>(options: {
  getEventStore?: () => Store;
  getApplication: (eventStore: Store) => Application;
  fetch?: never;
}): ApiSpecification<EventType>;
/** @deprecated Use `ApiSpecification.for({ getEventStore, getApplication })` instead */
function apiSpecificationFor<
  EventType extends Event = Event,
  Store extends EventStore = InMemoryEventStore,
>(
  getEventStore: () => Store,
  getApplication: (eventStore: Store) => Application,
): ApiSpecification<EventType>;
function apiSpecificationFor<
  EventType extends Event = Event,
  Store extends EventStore = InMemoryEventStore,
>(
  optionsOrGetEventStore:
    | {
        getEventStore?: () => Store;
        fetch: Fetch;
        getApplication?: never;
      }
    | {
        getEventStore?: () => Store;
        getApplication: (eventStore: Store) => Application;
        fetch?: never;
      }
    | (() => Store),
  getApplication?: (eventStore: Store) => Application,
): ApiSpecification<EventType> | FetchApiSpecification<EventType> {
  const resolveStoreAndRequestExecutor = (): {
    eventStore: ReturnType<typeof WrapEventStore>;
    executeRequest: (
      setupRequest: TestRequest | FetchTestRequestSetup,
    ) => Promise<SuperTestResponse | FetchTestResponse>;
  } => {
    if (typeof optionsOrGetEventStore === 'function') {
      const eventStore = WrapEventStore(optionsOrGetEventStore());
      const request = supertest(getApplication!(eventStore));
      return {
        eventStore,
        executeRequest: async (setupRequest) =>
          (setupRequest as TestRequest)(request),
      };
    }
    const configuredEventStore =
      optionsOrGetEventStore.getEventStore?.() ?? getInMemoryEventStore();
    const eventStore = WrapEventStore(configuredEventStore as Store);
    if (optionsOrGetEventStore.fetch !== undefined) {
      return {
        eventStore,
        executeRequest: (setupRequest) =>
          executeFetchRequest(
            optionsOrGetEventStore.fetch,
            setupRequest as FetchTestRequestSetup,
          ),
      };
    }

    const request = supertest(
      optionsOrGetEventStore.getApplication(eventStore),
    );
    return {
      eventStore,
      executeRequest: async (setupRequest) =>
        (setupRequest as TestRequest)(request),
    };
  };

  return (...givenStreams: TestEventStream<EventType>[]) => {
    const { eventStore, executeRequest } = resolveStoreAndRequestExecutor();

    return {
      when: (setupRequest: TestRequest | FetchTestRequestSetup) => {
        const handle = async (): Promise<
          SuperTestResponse | FetchTestResponse
        > => {
          for (const [streamName, events] of givenStreams) {
            await eventStore.setup(streamName, events);
          }

          return executeRequest(setupRequest);
        };

        return {
          then: async (
            verify:
              | ApiSpecificationAssert<EventType>
              | FetchApiSpecificationAssert<EventType>,
          ): Promise<void> => {
            const response = await handle();

            if (typeof verify === 'function') {
              const assertion = verify as (
                response: SuperTestResponse | FetchTestResponse,
              ) => boolean | void | Promise<boolean> | Promise<void>;
              const succeeded = await assertion(response);

              if (succeeded === false) assertFails();
            } else if (Array.isArray(verify)) {
              const [first, ...rest] = verify;

              if (typeof first === 'function') {
                const assertion = first as (
                  response: SuperTestResponse | FetchTestResponse,
                ) => boolean | void | Promise<boolean> | Promise<void>;
                const succeeded = await assertion(response);

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

export const ApiSpecification = {
  for: apiSpecificationFor,
};
