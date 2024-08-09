import {
  dumbo,
  type Dumbo,
  type DumboOptions,
  type QueryResultRow,
  type SQL,
} from '@event-driven-io/dumbo';
import {
  assertFails,
  AssertionError,
  assertThatArray,
  assertTrue,
  isErrorConstructor,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ThenThrows,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { handleProjections, type PostgreSQLProjectionDefinition } from '.';

export type PostgreSQLProjectionSpecEvent<EventType extends Event> =
  EventType & { metadata?: Partial<ReadEventMetadataWithGlobalPosition> };

export const eventInStream = <EventType extends Event = Event>(
  streamName: string,
  event: PostgreSQLProjectionSpecEvent<EventType>,
): PostgreSQLProjectionSpecEvent<EventType> => {
  return {
    ...event,
    metadata: {
      ...(event.metadata ?? {}),
      streamName: event.metadata?.streamName ?? streamName,
    },
  };
};

export const eventsInStream = <EventType extends Event = Event>(
  streamName: string,
  events: PostgreSQLProjectionSpecEvent<EventType>[],
): PostgreSQLProjectionSpecEvent<EventType>[] => {
  return events.map((e) => eventInStream(streamName, e));
};

export const newEventsInStream = eventsInStream;

export type PostgreSQLProjectionSpec<EventType extends Event> = (
  givenEvents: PostgreSQLProjectionSpecEvent<EventType>[],
) => {
  when: (events: PostgreSQLProjectionSpecEvent<EventType>[]) => {
    then: (
      assert: PostgreSQLProjectionAssert,
      message?: string,
    ) => Promise<void>;
    thenThrows: <ErrorType extends Error = Error>(
      ...args: Parameters<ThenThrows<ErrorType>>
    ) => Promise<void>;
  };
};

export type PostgreSQLProjectionAssert = (options: {
  pool: Dumbo;
  connectionString: string;
}) => Promise<void | boolean>;

export type PostgreSQLProjectionSpecOptions = {
  projection: PostgreSQLProjectionDefinition;
} & DumboOptions;

export const PostgreSQLProjectionSpec = {
  for: <EventType extends Event>(
    options: PostgreSQLProjectionSpecOptions,
  ): PostgreSQLProjectionSpec<EventType> => {
    {
      const { projection, ...dumoOptions } = options;
      const { connectionString } = dumoOptions;

      return (givenEvents: PostgreSQLProjectionSpecEvent<EventType>[]) => {
        return {
          when: (events: PostgreSQLProjectionSpecEvent<EventType>[]) => {
            const allEvents: ReadEvent<
              EventType,
              ReadEventMetadataWithGlobalPosition
            >[] = [];

            const run = async (pool: Dumbo) => {
              let globalPosition = 0n;
              const streamName = 'defaultStreamName';

              for (const event of [...givenEvents, ...events]) {
                const eventId = uuid();
                allEvents.push({
                  ...event,
                  metadata: {
                    ...{
                      globalPosition,
                      streamPosition: globalPosition,
                      streamName,
                      eventId,
                    },
                    ...(event.metadata ?? {}),
                  },
                });

                globalPosition++;
              }

              await pool.withTransaction((transaction) =>
                handleProjections(
                  [projection],
                  connectionString,
                  transaction,
                  allEvents,
                ),
              );
            };

            return {
              then: async (
                assert: PostgreSQLProjectionAssert,
                message?: string,
              ): Promise<void> => {
                const pool = dumbo(dumoOptions);
                try {
                  await run(pool);

                  const succeeded = await assert({ pool, connectionString });

                  if (succeeded !== undefined && succeeded === false)
                    assertFails(
                      message ??
                        "Projection specification didn't match the criteria",
                    );
                } finally {
                  await pool.close();
                }
              },
              thenThrows: async <ErrorType extends Error>(
                ...args: Parameters<ThenThrows<ErrorType>>
              ): Promise<void> => {
                const pool = dumbo(dumoOptions);
                try {
                  await run(pool);
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
                  await pool.close();
                }
              },
            };
          },
        };
      };
    }
  },
};

export const assertSQLQueryResultMatches =
  <T extends QueryResultRow>(sql: SQL, rows: T[]): PostgreSQLProjectionAssert =>
  async ({ pool: { execute } }) => {
    const result = await execute.query<T>(sql);

    assertThatArray(rows).containsExactlyInAnyOrder(...result.rows);
  };

export const expectSQL = {
  query: (sql: SQL) => ({
    resultRows: {
      toBeTheSame: <T extends QueryResultRow>(rows: T[]) =>
        assertSQLQueryResultMatches(sql, rows),
    },
  }),
};
