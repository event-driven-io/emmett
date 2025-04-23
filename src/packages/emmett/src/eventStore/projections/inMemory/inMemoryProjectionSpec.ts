/* eslint-disable */
// @ts-nocheck - This is a test utility file with intentionally relaxed type checking
import { strict as assert } from 'assert';
import { v4 as uuid } from 'uuid';
import {
  handleInMemoryProjections,
  type InMemoryProjectionDefinition,
} from '.';
import {
  getInMemoryDatabase,
  type Database,
} from '../../../database/inMemoryDatabase';
import { type Event, type ReadEvent } from '../../../typing';
import type { InMemoryReadEventMetadata } from '../../inMemoryEventStore';

// Define minimal type for the mock eventStore used in testing
type _MockEventStore = {
  database: Database;
};

export type InMemoryProjectionSpecEvent<EventType extends Event> = EventType & {
  metadata?: Partial<InMemoryReadEventMetadata>;
};

export type InMemoryProjectionSpecWhenOptions = { numberOfTimes: number };

export type InMemoryProjectionAssert = (options: {
  database: Database;
}) => Promise<void | boolean>;

export type InMemoryProjectionSpecOptions<EventType extends Event> = {
  projection: InMemoryProjectionDefinition<EventType>;
};

export const InMemoryProjectionSpec = {
  for: <EventType extends Event>(
    options: InMemoryProjectionSpecOptions<EventType>,
  ) => {
    const { projection } = options;

    return (givenEvents: InMemoryProjectionSpecEvent<EventType>[]) => {
      return {
        when: (
          events: InMemoryProjectionSpecEvent<EventType>[],
          options?: InMemoryProjectionSpecWhenOptions,
        ) => {
          const allEvents: ReadEvent<EventType, InMemoryReadEventMetadata>[] =
            [];

          const run = async (database: Database) => {
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

              // @ts-expect-error - Simplifying type casting for test code, intentional for testing
              allEvents.push({
                ...event,
                kind: 'Event',
                metadata: {
                  ...metadata,
                  ...('metadata' in event ? (event.metadata ?? {}) : {}),
                },
              });
            }

            // @ts-expect-error - Using any for test code, intentional for testing
            await handleInMemoryProjections({
              events: allEvents,
              projections: [projection],
              database,
              eventStore: { database } as any,
            });
          };

          return {
            then: async (
              assertFn: InMemoryProjectionAssert,
              message?: string,
            ): Promise<void> => {
              const database = getInMemoryDatabase();
              try {
                await run(database);

                const succeeded = await assertFn({ database });

                if (succeeded !== undefined && succeeded === false)
                  assert.fail(
                    message ??
                      "Projection specification didn't match the criteria",
                  );
              } catch (error) {
                throw error;
              }
            },
            thenThrows: async <_ErrorType extends Error>(
              errorTypeOrPredicate: any,
              predicate?: (error: any) => boolean,
            ): Promise<void> => {
              const database = getInMemoryDatabase();
              try {
                await run(database);
                throw new assert.AssertionError({
                  message: 'Handler did not fail as expected',
                });
              } catch (error) {
                if (error instanceof assert.AssertionError) throw error;

                if (!errorTypeOrPredicate) return;

                // Handle either error type constructor or predicate function
                if (typeof errorTypeOrPredicate === 'function') {
                  if (errorTypeOrPredicate.prototype instanceof Error) {
                    // It's a constructor
                    if (!(error instanceof errorTypeOrPredicate)) {
                      assert.fail(
                        `Error is not an instance of expected type: ${error}`,
                      );
                    }

                    if (predicate && !predicate(error)) {
                      assert.fail(
                        `Error didn't match the error condition: ${error}`,
                      );
                    }
                  } else {
                    // It's a predicate function
                    if (!errorTypeOrPredicate(error)) {
                      assert.fail(
                        `Error didn't match the error condition: ${error}`,
                      );
                    }
                  }
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
export const eventInStream = <EventType extends Event>(
  streamName: string,
  event: InMemoryProjectionSpecEvent<EventType>,
): InMemoryProjectionSpecEvent<EventType> => {
  return {
    ...event,
    metadata: {
      ...(event.metadata ?? {}),
      streamName: event.metadata?.streamName ?? streamName,
    },
  };
};

export const eventsInStream = <EventType extends Event>(
  streamName: string,
  events: InMemoryProjectionSpecEvent<EventType>[],
): InMemoryProjectionSpecEvent<EventType>[] => {
  return events.map((e) => eventInStream(streamName, e));
};

export const newEventsInStream = eventsInStream;

// Assertion helpers for checking documents
export function documentExists<T extends object & { [key: string]: any }>(
  expected: Partial<T>,
  options: { inCollection: string; withId: string | number },
): InMemoryProjectionAssert {
  return async ({ database }) => {
    // @ts-expect-error - Safe to use for testing database collections
    const collection = database.collection<T>(options.inCollection);
    // @ts-expect-error - Safe to use for testing document finding
    const document = collection.findOne((doc) => {
      // Handle both string IDs and numeric IDs
      // @ts-expect-error - Document structure varies, this is intentional for testing
      const docId = doc._id ?? doc.id;
      return docId === options.withId;
    });

    if (!document) {
      assert.fail(
        `Document with ID ${options.withId} does not exist in collection ${options.inCollection}`,
      );
      return false;
    }

    // Check that all expected properties exist with expected values
    for (const [key, value] of Object.entries(expected)) {
      // @ts-expect-error - Property access on dynamic keys in test code
      if (
        document[key] === undefined ||
        JSON.stringify(document[key]) !== JSON.stringify(value)
      ) {
        assert.fail(`Property ${key} doesn't match the expected value`);
        return false;
      }
    }

    return true;
  };
}

// Helper for checking document contents
export const expectInMemoryDocuments = {
  fromCollection: <T extends object>(collectionName: string) => ({
    withId: (id: string | number) => ({
      toBeEqual: (expected: Partial<T>): InMemoryProjectionAssert =>
        documentExists<T>(expected, {
          inCollection: collectionName,
          withId: id,
        }),
    }),
  }),
};
