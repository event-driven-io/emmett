import type {
  AnyDumboDatabaseDriver,
  DumboDatabaseDriver,
  ExtractDumboDatabaseDriverOptions,
  ExtractDumboTypeFromDriver,
  InferDbClientFromConnection,
  InferTransactionFromConnection,
} from '@event-driven-io/dumbo';

export interface EventStoreDriver<
  DatabaseDriver extends AnyDumboDatabaseDriver = AnyDumboDatabaseDriver,
  DriverOptions extends AnyEventStoreDriverOptions = AnyEventStoreDriverOptions,
> {
  driverType: DatabaseDriver['driverType'];
  dumboDriver: DatabaseDriver;
  mapToDumboOptions(
    driverOptions: DriverOptions,
  ): ExtractDumboDatabaseDriverOptions<DatabaseDriver>;
}

export type EventStoreDriverOptions<
  Driver extends AnyEventStoreDriver = AnyEventStoreDriver,
> = {
  connectionOptions?:
    ExtractDumboDatabaseDriverOptions<Driver['dumboDriver']> | undefined;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEventStoreDriverOptions = EventStoreDriverOptions<any>;

export type AnyEventStoreDriver = EventStoreDriver<
  AnyDumboDatabaseDriver,
  AnyEventStoreDriverOptions
>;

export type InferOptionsFromEventStoreDriver<C extends AnyEventStoreDriver> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  C extends EventStoreDriver<any, infer DO> ? DO : never;

/**
 * The options `mapToDumboOptions` produces for this driver. A handler context
 * carries them, so a pg user reaches a connection string while a driver
 * without one exposes whatever it does have.
 */
export type InferDumboOptionsFromEventStoreDriver<
  C extends AnyEventStoreDriver,
> = ExtractDumboDatabaseDriverOptions<C['dumboDriver']>;

export type InferDumboConnectionFromEventStoreDriver<
  Driver extends AnyEventStoreDriver,
> =
  Driver['dumboDriver'] extends DumboDatabaseDriver<
    infer ConnectionType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  >
    ? ConnectionType
    : never;

export type InferPoolFromEventStoreDriver<Driver extends AnyEventStoreDriver> =
  ExtractDumboTypeFromDriver<Driver['dumboDriver']>;

export type InferDbClientFromEventStoreDriver<
  Driver extends AnyEventStoreDriver,
> = InferDbClientFromConnection<
  InferDumboConnectionFromEventStoreDriver<Driver>
>;

export type InferTransactionFromEventStoreDriver<
  Driver extends AnyEventStoreDriver,
> = InferTransactionFromConnection<
  InferDumboConnectionFromEventStoreDriver<Driver>
>;
