import {
  assertFails,
  AssertionError,
  assertTrue,
  deepEquals,
  isErrorConstructor,
  isSubset,
  projections,
  type Event,
  type ThenThrows,
} from '@event-driven-io/emmett';
import { MongoClient, type Document } from 'mongodb';
import {
  getMongoDBEventStore,
  type MongoDBEventStore,
  type MongoDBEventStoreConnectionOptions,
  type MongoDBReadModel,
  type StreamName,
} from '../mongoDBEventStore';
import {
  MongoDBDefaultInlineProjectionName,
  type MongoDBInlineProjectionDefinition,
} from './mongoDBInlineProjection';

export type MongoDBInlineProjectionSpecGivenEvents<
  StreamNameType extends StreamName,
  EventType extends Event,
> = {
  streamName: StreamNameType;
  events: EventType[];
};

export type MongoDBInlineProjectionSpec<
  StreamNameType extends StreamName,
  EventType extends Event,
> = (
  givenStream: MongoDBInlineProjectionSpecGivenEvents<
    StreamNameType,
    EventType
  >,
) => {
  when: (events: EventType[]) => {
    then: (
      assert: MongoDBInlineProjectionAssert,
      message?: string,
    ) => Promise<void>;
    thenThrows: <ErrorType extends Error = Error>(
      ...args: Parameters<ThenThrows<ErrorType>>
    ) => Promise<void>;
  };
};

export type MongoDBInlineProjectionAssertOptions<
  StreamNameType extends StreamName = StreamName,
> = {
  streamName: StreamNameType;
  eventStore: MongoDBEventStore;
};

export type MongoDBInlineProjectionAssert<
  StreamNameType extends StreamName = StreamName,
> = (
  options: MongoDBInlineProjectionAssertOptions<StreamNameType>,
) => Promise<void | boolean>;

export type MongoDBInlineProjectionSpecOptions = {
  projection: MongoDBInlineProjectionDefinition;
} & MongoDBEventStoreConnectionOptions;

export const MongoDBInlineProjectionSpec = {
  for: <StreamNameType extends StreamName, EventType extends Event>(
    options: MongoDBInlineProjectionSpecOptions,
  ): MongoDBInlineProjectionSpec<StreamNameType, EventType> => {
    {
      const { projection, ...connectionOptions } = options;

      return (
        givenStream: MongoDBInlineProjectionSpecGivenEvents<
          StreamNameType,
          EventType
        >,
      ) => {
        const { streamName, events: givenEvents } = givenStream;
        return {
          when: (events: EventType[]) => {
            const allEvents = [...givenEvents, ...events];

            const run = (eventStore: MongoDBEventStore) =>
              eventStore.appendToStream(streamName, allEvents);

            return {
              then: async (
                assert: MongoDBInlineProjectionAssert,
                message?: string,
              ): Promise<void> => {
                const client =
                  'client' in connectionOptions && connectionOptions.client
                    ? connectionOptions.client
                    : new MongoClient(
                        connectionOptions.connectionString,
                        connectionOptions.clientOptions,
                      );

                const eventStore = getMongoDBEventStore({
                  projections: projections.inline([projection]),
                  client,
                });

                try {
                  await run(eventStore);

                  const succeeded = await assert({ eventStore, streamName });

                  if (succeeded !== undefined && succeeded === false)
                    assertFails(
                      message ??
                        "Projection specification didn't match the criteria",
                    );
                } finally {
                  await client.close();
                }
              },
              thenThrows: async <ErrorType extends Error>(
                ...args: Parameters<ThenThrows<ErrorType>>
              ): Promise<void> => {
                const client =
                  'client' in connectionOptions && connectionOptions.client
                    ? connectionOptions.client
                    : new MongoClient(
                        connectionOptions.connectionString,
                        connectionOptions.clientOptions,
                      );

                const eventStore = getMongoDBEventStore({
                  projections: projections.inline([projection]),
                  client,
                });

                try {
                  await run(eventStore);
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
                  await client.close();
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
  StreamNameType extends StreamName,
  EventType extends Event,
>(
  streamName: StreamNameType,
  event: EventType,
): MongoDBInlineProjectionSpecGivenEvents<StreamNameType, EventType> => ({
  streamName,
  events: [event],
});

export const eventsInStream = <
  StreamNameType extends StreamName,
  EventType extends Event,
>(
  streamName: StreamNameType,
  events: EventType[],
): MongoDBInlineProjectionSpecGivenEvents<StreamNameType, EventType> => ({
  streamName,
  events,
});

const expectReadModelToMatch = async <
  Doc extends Document = Document,
  StreamNameType extends StreamName = StreamName,
>(
  options: MongoDBInlineProjectionAssertOptions<StreamNameType> & {
    projectionName: string;
    match: (readModel: MongoDBReadModel<Doc> | null) => boolean;
  },
) => {
  const { streamName, projectionName, eventStore, match } = options;
  const readModel = await eventStore.projections.inline.findOne<Doc>({
    streamName,
    projectionName,
  });

  return match(readModel);
};

const expectInlineReadModelWithName = (projectionName: string) => ({
  toHave:
    <Doc extends Document, StreamNameType extends StreamName = StreamName>(
      expected: Partial<MongoDBReadModel<Doc>> | null,
    ): MongoDBInlineProjectionAssert<StreamNameType> =>
    ({ eventStore, streamName }) =>
      expectReadModelToMatch<Doc>({
        eventStore,
        streamName,
        projectionName,
        match: (readModel) => isSubset(readModel, expected),
      }),
  toDeepEquals:
    <Doc extends Document, StreamNameType extends StreamName = StreamName>(
      expected: MongoDBReadModel<Doc> | null,
    ): MongoDBInlineProjectionAssert<StreamNameType> =>
    ({ eventStore, streamName }) =>
      expectReadModelToMatch<Doc>({
        eventStore,
        streamName,
        projectionName,
        match: (readModel) => deepEquals(readModel, expected),
      }),
  toMatch:
    <Doc extends Document, StreamNameType extends StreamName = StreamName>(
      match: (readModel: MongoDBReadModel<Doc> | null) => boolean,
    ): MongoDBInlineProjectionAssert<StreamNameType> =>
    ({ eventStore, streamName }) =>
      expectReadModelToMatch<Doc>({
        eventStore,
        streamName,
        projectionName,
        match,
      }),
  notToExist:
    <
      StreamNameType extends StreamName = StreamName,
    >(): MongoDBInlineProjectionAssert<StreamNameType> =>
    ({ eventStore, streamName }) =>
      expectReadModelToMatch({
        eventStore,
        streamName,
        projectionName,
        match: (readModel) => readModel === null,
      }),
  toExist:
    (): MongoDBInlineProjectionAssert =>
    ({ eventStore, streamName }) =>
      expectReadModelToMatch({
        eventStore,
        streamName,
        projectionName,
        match: (readModel) => readModel !== null,
      }),
});

export const expectInlineReadModel = {
  withName: (name: string) => expectInlineReadModelWithName(name),
  ...expectInlineReadModelWithName(MongoDBDefaultInlineProjectionName),
};
