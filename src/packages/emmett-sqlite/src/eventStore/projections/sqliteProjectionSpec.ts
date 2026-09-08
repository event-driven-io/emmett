import type { MigrationStyle, SQL } from '@event-driven-io/dumbo';
import { dumbo, type Dumbo, type QueryResultRow } from '@event-driven-io/dumbo';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite';
import {
  assertFails,
  AssertionError,
  assertThatArray,
  assertTrue,
  bigIntProcessorCheckpoint,
  isErrorConstructor,
  type CombinedReadEventMetadata,
  type Event,
  type JSONSerializationOptions,
  type ReadEvent,
  type ThenThrows,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import type {
  AnySQLiteEventStoreDriver,
  InferDumboOptionsFromEventStoreDriver,
  InferDumboConnectionFromEventStoreDriver,
  InferOptionsFromEventStoreDriver,
} from '../eventStoreDriver';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from '../schema';
import {
  getSQLiteEventStore,
  type SQLiteReadEventMetadata,
} from '../SQLiteEventStore';
import {
  handleProjections,
  transactionToSQLiteProjectionHandlerContext,
  type SQLiteProjectionDefinition,
} from './sqliteProjection';

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
  connection: AnySQLiteConnection;
  driver: AnySQLiteEventStoreDriver;
  migrationOptions?: EventStoreDatabaseSchemaOptions | undefined;
}) => Promise<void | boolean>;

export type SQLiteProjectionSpecOptions<
  EventType extends Event,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = {
  projection: SQLiteProjectionDefinition<EventType>;

  driver: Driver;
  pool?: Dumbo;
  schema?:
    | ({ autoMigration?: MigrationStyle } & EventStoreDatabaseSchemaOptions)
    | undefined;
} & InferOptionsFromEventStoreDriver<Driver> &
  JSONSerializationOptions;

export const SQLiteProjectionSpec = {
  for: <
    EventType extends Event,
    Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
  >(
    options: SQLiteProjectionSpecOptions<EventType, Driver>,
  ): SQLiteProjectionSpec<EventType> => {
    {
      const driver = options.driver;
      const dumboOptions = {
        serialization: options.serialization,
        transactionOptions: {
          allowNestedTransactions: true,
          mode: 'session_based',
        },
        ...options.driver.mapToDumboOptions(options),
      } as InferDumboOptionsFromEventStoreDriver<Driver>;

      const pool = options.pool ?? dumbo(dumboOptions);

      const session = {
        pool: pool,
        driver,
        connectionOptions: dumboOptions,
      };
      const projection = options.projection;
      const migrationOptions = {
        ...options.schema,
        ...eventStoreDatabaseSchema(options.schema),
      };
      let wasInitialized = false;

      const initialize = async (
        connection: AnySQLiteConnection,
      ): Promise<void> => {
        if (wasInitialized) return;

        wasInitialized = true;

        const eventStore = getSQLiteEventStore({ ...options, pool });
        await eventStore.schema.migrate();

        if (projection.init)
          await connection.withTransaction(async (transaction) => {
            await projection.init!({
              registrationType: 'async',
              status: 'active',
              context: {
                ...transactionToSQLiteProjectionHandlerContext(
                  session,
                  transaction,
                ),
                migrationOptions,
              },
              version: projection.version ?? 1,
            });
          });
      };

      return (givenEvents: SQLiteProjectionSpecEvent<EventType>[]) => {
        return {
          when: (
            events: SQLiteProjectionSpecEvent<EventType>[],
            options?: SQLiteProjectionSpecWhenOptions,
          ) => {
            const allEvents: ReadEvent<EventType, SQLiteReadEventMetadata>[] =
              [];

            const run = async (untypedConnection: AnySQLiteConnection) => {
              // TODO: Fix this cast when the pool plumbing is driver-generic
              const connection =
                untypedConnection as InferDumboConnectionFromEventStoreDriver<Driver>;
              let globalPosition = 0n;
              const numberOfTimes = options?.numberOfTimes ?? 1;

              for (const event of [
                ...givenEvents,
                ...Array.from({ length: numberOfTimes }).flatMap(() => events),
              ]) {
                const metadata: SQLiteReadEventMetadata = {
                  checkpoint: bigIntProcessorCheckpoint(++globalPosition),
                  globalPosition: bigIntProcessorCheckpoint(globalPosition),
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

              await initialize(connection);

              await connection.withTransaction((transaction) =>
                handleProjections({
                  events: allEvents,
                  projections: [projection],
                  ...transactionToSQLiteProjectionHandlerContext(
                    session,
                    transaction,
                  ),
                  migrationOptions,
                }),
              );
            };

            return {
              then: (
                assert: SQLiteProjectionAssert,
                message?: string,
              ): Promise<void> =>
                pool.withConnection(async (connection) => {
                  await run(connection);

                  const succeeded = await assert({
                    connection,
                    driver,
                    migrationOptions,
                  });

                  if (succeeded !== undefined && succeeded === false)
                    assertFails(
                      message ??
                        "Projection specification didn't match the criteria",
                    );
                }),
              thenThrows: <ErrorType extends Error>(
                ...args: Parameters<ThenThrows<ErrorType>>
              ): Promise<void> =>
                pool.withConnection(async (connection) => {
                  try {
                    await run(connection);
                    throw new AssertionError(
                      'Handler did not fail as expected',
                    );
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
                }),
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
  <T extends QueryResultRow>(sql: SQL, rows: T[]): SQLiteProjectionAssert =>
  async ({
    connection,
  }: {
    connection: AnySQLiteConnection;
  }): Promise<void> => {
    const result = await connection.execute.query<T>(sql);

    assertThatArray(rows).containsExactlyInAnyOrder(result.rows);
  };

export const expectSQL = {
  query: (sql: SQL) => ({
    resultRows: {
      toBeTheSame: <T extends QueryResultRow>(rows: T[]) =>
        assertSQLQueryResultMatches(sql, rows),
    },
  }),
};
