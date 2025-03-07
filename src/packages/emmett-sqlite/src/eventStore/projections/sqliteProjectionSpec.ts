import { type QueryResultRow, type SQL } from '@event-driven-io/dumbo';
import {
  assertFails,
  AssertionError,
  assertThatArray,
  assertTrue,
  isErrorConstructor,
  type CombinedReadEventMetadata,
  type Event,
  type ReadEvent,
  type ThenThrows,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { handleProjections, type SQLiteProjectionDefinition } from '.';
import { type SQLiteConnection } from '../../connection';
import { type SQLiteReadEventMetadata } from '../SQLiteEventStore';

export type SQLiteProjectionSpecEvent<
  EventType extends Event,
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
> = EventType & {
  metadata?: Partial<EventMetaDataType>;
};

export type SQLiteProjectionSpecWhenOptions = {
  numberOfTimes: number;
};

export type SQLiteProjectionSpec<EventType extends Event> = (
  givenEvents: SQLiteProjectionSpecEvent<EventType>[],
) => {
  when: (
    events: SQLiteProjectionSpecEvent<EventType>[],
    options?: SQLiteProjectionSpecWhenOptions,
  ) => {
    then: (assert: SQLiteProjectionAssert, message?: string) => Promise<void>;
    thenThrows: <ErrorType extends Error = Error>(
      ...args: Parameters<ThenThrows<ErrorType>>
    ) => Promise<void>;
  };
};

export type SQLiteProjectionAssert = (options: {
  connection: SQLiteConnection;
}) => Promise<void | boolean>;

export type SQLiteProjectionSpecOptions<EventType extends Event> = {
  connection: SQLiteConnection;
  projection: SQLiteProjectionDefinition<EventType>;
};

export const SQLiteProjectionSpec = {
  for: <EventType extends Event>(
    options: SQLiteProjectionSpecOptions<EventType>,
  ): SQLiteProjectionSpec<EventType> => {
    {
      const connection = options.connection;
      const projection = options.projection;

      return (givenEvents: SQLiteProjectionSpecEvent<EventType>[]) => {
        return {
          when: (
            events: SQLiteProjectionSpecEvent<EventType>[],
            options?: SQLiteProjectionSpecWhenOptions,
          ) => {
            const allEvents: ReadEvent<EventType, SQLiteReadEventMetadata>[] =
              [];

            const run = async (connection: SQLiteConnection) => {
              let globalPosition = 0n;
              const numberOfTimes = options?.numberOfTimes ?? 1;

              for (const event of [
                ...givenEvents,
                ...Array.from({ length: numberOfTimes }).flatMap(() => events),
              ]) {
                const metadata: SQLiteReadEventMetadata = {
                  globalPosition: ++globalPosition,
                  streamPosition: globalPosition,
                  streamName: `test-${uuid()}`,
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
                    SQLiteReadEventMetadata
                  >,
                });
              }

              await connection.withTransaction(() =>
                handleProjections({
                  events: allEvents,
                  projections: [projection],
                  connection,
                }),
              );
            };

            return {
              then: async (
                assert: SQLiteProjectionAssert,
                message?: string,
              ): Promise<void> => {
                try {
                  await run(connection);

                  const succeeded = await assert({
                    connection,
                  });

                  if (succeeded !== undefined && succeeded === false)
                    assertFails(
                      message ??
                        "Projection specification didn't match the criteria",
                    );
                } finally {
                  connection.close();
                }
              },
              thenThrows: async <ErrorType extends Error>(
                ...args: Parameters<ThenThrows<ErrorType>>
              ): Promise<void> => {
                try {
                  await run(connection);
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
                } finally {
                  connection.close();
                }
              },
            };
          },
        };
      };
    }
  },
};

export const eventInStream = <
  EventType extends Event = Event,
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
>(
  streamName: string,
  event: SQLiteProjectionSpecEvent<EventType, EventMetaDataType>,
): SQLiteProjectionSpecEvent<EventType, EventMetaDataType> => {
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
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
>(
  streamName: string,
  events: SQLiteProjectionSpecEvent<EventType, EventMetaDataType>[],
): SQLiteProjectionSpecEvent<EventType, EventMetaDataType>[] => {
  return events.map((e) => eventInStream(streamName, e));
};

export const newEventsInStream = eventsInStream;

export const assertSQLQueryResultMatches =
  <T extends QueryResultRow>(sql: string, rows: T[]): SQLiteProjectionAssert =>
  async (connection: SQLiteConnection) => {
    const result = await connection.query<T>(sql);

    assertThatArray(rows).containsExactlyInAnyOrder(result);
  };

export const expectSQL = {
  query: (sql: SQL) => ({
    resultRows: {
      toBeTheSame: <T extends QueryResultRow>(rows: T[]) =>
        assertSQLQueryResultMatches(sql, rows),
    },
  }),
};
