import { v4 as uuid } from 'uuid';
import {
  handleInMemoryProjections,
  type InMemoryProjectionDefinition,
} from '.';
import {
  getInMemoryDatabase,
  type Document,
  type InMemoryDatabase,
} from '../../../database';
import { isErrorConstructor } from '../../../errors';
import {
  assertFails,
  AssertionError,
  assertTrue,
  type ThenThrows,
} from '../../../testing';
import type { CombinedReadEventMetadata, ReadEvent } from '../../../typing';
import { type Event } from '../../../typing';
import type {
  InMemoryEventStore,
  InMemoryReadEventMetadata,
} from '../../inMemoryEventStore';

// Define a more specific type for T that extends Document
type DocumentWithId = Document & { _id?: string | number };

export type InMemoryProjectionSpecEvent<
  EventType extends Event,
  EventMetaDataType extends
    InMemoryReadEventMetadata = InMemoryReadEventMetadata,
> = EventType & {
  metadata?: Partial<EventMetaDataType>;
};

export type InMemoryProjectionSpecWhenOptions = { numberOfTimes: number };

export type InMemoryProjectionSpec<EventType extends Event> = (
  givenEvents: InMemoryProjectionSpecEvent<EventType>[],
) => {
  when: (
    events: InMemoryProjectionSpecEvent<EventType>[],
    options?: InMemoryProjectionSpecWhenOptions,
  ) => {
    then: (assert: InMemoryProjectionAssert, message?: string) => Promise<void>;
    thenThrows: <ErrorType extends Error = Error>(
      ...args: Parameters<ThenThrows<ErrorType>>
    ) => Promise<void>;
  };
};

export type InMemoryProjectionAssert = (options: {
  database: InMemoryDatabase;
}) => Promise<void | boolean>;

export type InMemoryProjectionSpecOptions<EventType extends Event> = {
  projection: InMemoryProjectionDefinition<EventType>;
};

export const InMemoryProjectionSpec = {
  for: <EventType extends Event>(
    options: InMemoryProjectionSpecOptions<EventType>,
  ): InMemoryProjectionSpec<EventType> => {
    const { projection } = options;

    return (givenEvents: InMemoryProjectionSpecEvent<EventType>[]) => {
      return {
        when: (
          events: InMemoryProjectionSpecEvent<EventType>[],
          options?: InMemoryProjectionSpecWhenOptions,
        ) => {
          const allEvents: ReadEvent<EventType, InMemoryReadEventMetadata>[] =
            [];

          const run = async (database: InMemoryDatabase) => {
            let globalPosition = 0n;
            const numberOfTimes = options?.numberOfTimes ?? 1;

            for (const event of [
              ...givenEvents,
              ...Array.from({ length: numberOfTimes }).flatMap(() => events),
            ]) {
              const metadata: InMemoryReadEventMetadata = {
                globalPosition: ++globalPosition,
                streamPosition: globalPosition,
                streamName: event.metadata?.streamName ?? `test-${uuid()}`,
                messageId: uuid(),
              };

              allEvents.push({
                ...event,
                kind: 'Event',
                metadata: {
                  ...metadata,
                  ...('metadata' in event ? (event.metadata ?? {}) : {}),
                } as CombinedReadEventMetadata<
                  EventType,
                  InMemoryReadEventMetadata
                >,
              });
            }

            // Create a minimal mock EventStore implementation
            const mockEventStore = {
              database,
              aggregateStream: async () => {
                return Promise.resolve({
                  state: {},
                  currentStreamVersion: 0n,
                  streamExists: false,
                });
              },
              readStream: async () => {
                return Promise.resolve({
                  events: [],
                  currentStreamVersion: 0n,
                  streamExists: false,
                });
              },
              appendToStream: async () => {
                return Promise.resolve({
                  nextExpectedStreamVersion: 0n,
                  createdNewStream: false,
                });
              },
            } as InMemoryEventStore;

            await handleInMemoryProjections({
              events: allEvents,
              projections: [projection],
              database,
              eventStore: mockEventStore,
            });
          };

          return {
            then: async (
              assertFn: InMemoryProjectionAssert,
              message?: string,
            ): Promise<void> => {
              const database = getInMemoryDatabase();
              await run(database);

              const succeeded = await assertFn({ database });

              if (succeeded !== undefined && succeeded === false) {
                assertFails(
                  message ??
                    "Projection specification didn't match the criteria",
                );
              }
            },
            thenThrows: async <ErrorType extends Error = Error>(
              ...args: Parameters<ThenThrows<ErrorType>>
            ): Promise<void> => {
              const database = getInMemoryDatabase();
              try {
                await run(database);
                throw new AssertionError('Handler did not fail as expected');
              } catch (error) {
                if (error instanceof AssertionError) throw error;

                if (args.length === 0) return;

                if (!isErrorConstructor(args[0])) {
                  assertTrue(
                    args[0](error as ErrorType),
                    `Error didn't match the error condition: ${error?.toString()}`,
                  );
                  return;
                }

                assertTrue(
                  error instanceof args[0],
                  `Caught error is not an instance of the expected type: ${error?.toString()}`,
                );

                if (args[1]) {
                  assertTrue(
                    args[1](error as ErrorType),
                    `Error didn't match the error condition: ${error?.toString()}`,
                  );
                }
              }
            },
          };
        },
      };
    };
  },
};

// Helper functions for creating events in stream
export const eventInStream = <
  EventType extends Event = Event,
  EventMetaDataType extends
    InMemoryReadEventMetadata = InMemoryReadEventMetadata,
>(
  streamName: string,
  event: InMemoryProjectionSpecEvent<EventType, EventMetaDataType>,
): InMemoryProjectionSpecEvent<EventType, EventMetaDataType> => {
  return {
    ...event,
    metadata: {
      ...(event.metadata ?? {}),
      streamName: event.metadata?.streamName ?? streamName,
    } as Partial<EventMetaDataType>,
  };
};

export const eventsInStream = <
  EventType extends Event = Event,
  EventMetaDataType extends
    InMemoryReadEventMetadata = InMemoryReadEventMetadata,
>(
  streamName: string,
  events: InMemoryProjectionSpecEvent<EventType, EventMetaDataType>[],
): InMemoryProjectionSpecEvent<EventType, EventMetaDataType>[] => {
  return events.map((e) => eventInStream(streamName, e));
};

export const newEventsInStream = eventsInStream;

// Assertion helpers for checking documents
export function documentExists<T extends DocumentWithId>(
  expected: Partial<T>,
  options: { inCollection: string; withId: string | number },
): InMemoryProjectionAssert {
  return async ({ database }) => {
    const collection = database.collection<T>(options.inCollection);

    const document = await collection.findOne((doc) => {
      // Handle both string IDs and numeric IDs in a type-safe way
      const docId = '_id' in doc ? doc._id : undefined;
      return docId === options.withId;
    });

    if (!document) {
      assertFails(
        `Document with ID ${options.withId} does not exist in collection ${options.inCollection}`,
      );
      return Promise.resolve(false);
    }

    // Check that all expected properties exist with expected values
    for (const [key, value] of Object.entries(expected)) {
      const propKey = key as keyof typeof document;
      if (
        !(key in document) ||
        JSON.stringify(document[propKey]) !== JSON.stringify(value)
      ) {
        assertFails(`Property ${key} doesn't match the expected value`);
        return Promise.resolve(false);
      }
    }

    return Promise.resolve(true);
  };
}

// Helper for checking document contents
export const expectInMemoryDocuments = {
  fromCollection: <T extends DocumentWithId>(collectionName: string) => ({
    withId: (id: string | number) => ({
      toBeEqual: (expected: Partial<T>): InMemoryProjectionAssert =>
        documentExists<T>(expected, {
          inCollection: collectionName,
          withId: id,
        }),
    }),
  }),
};
