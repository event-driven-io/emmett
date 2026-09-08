import { EmmettError } from '@event-driven-io/emmett';
import type { AnyPongoDriver } from '@event-driven-io/pongo';
import type {
  AnySQLiteConnection,
  SQLiteDriverType,
} from '@event-driven-io/dumbo/sqlite';
import type {
  AnyDumboDatabaseDriver,
  Dumbo,
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
  pongoDriver?: AnyPongoDriver;
  mapToDumboOptions(
    options: DriverOptions,
  ): ExtractDumboDatabaseDriverOptions<DatabaseDriver>;
}

export const eventStoreDriverOf = <
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  driver: Driver | undefined,
): Driver => {
  if (!driver)
    throw new EmmettError(
      `The handler context carries no event store driver. Ensure that you passed it to getSQLiteEventStore.`,
    );

  return driver;
};

export const pongoDriverOf = (
  driver: AnySQLiteEventStoreDriver | undefined,
): AnyPongoDriver => {
  const pongoDriver = eventStoreDriverOf(driver).pongoDriver;

  if (!pongoDriver)
    throw new EmmettError(
      `Pongo projections need a Pongo driver on the event store driver. Ensure that the driver you passed to getSQLiteEventStore defines 'pongoDriver'.`,
    );

  return pongoDriver;
};

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

/**
 * Any driver this package can actually talk to. Constraining on it keeps
 * `context.session.connection` a SQLite connection, whichever SQLite driver
 * you picked.
 */
export type AnySQLiteEventStoreDriver = Omit<
  EventStoreDriver<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    DumboDatabaseDriver<AnySQLiteConnection, any>,
    AnyEventStoreDriverOptions
  >,
  'driverType'
> & { driverType: SQLiteDriverType };

export type InferOptionsFromEventStoreDriver<
  C extends AnySQLiteEventStoreDriver,
> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  C extends EventStoreDriver<any, infer DO> ? DO : never;

/**
 * The options `mapToDumboOptions` produces for this driver. A handler context
 * carries them, so a pg user reaches a connection string while a driver
 * without one exposes whatever it does have.
 */
export type InferDumboOptionsFromEventStoreDriver<
  C extends AnySQLiteEventStoreDriver,
> = ExtractDumboDatabaseDriverOptions<C['dumboDriver']>;

export type InferDumboConnectionFromEventStoreDriver<
  Driver extends AnySQLiteEventStoreDriver,
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

export type InferPoolFromEventStoreDriver<
  Driver extends AnySQLiteEventStoreDriver,
> = ExtractDumboTypeFromDriver<Driver['dumboDriver']>;

export type InferDbClientFromEventStoreDriver<
  Driver extends AnySQLiteEventStoreDriver,
> = InferDbClientFromConnection<
  InferDumboConnectionFromEventStoreDriver<Driver>
>;

export type InferTransactionFromEventStoreDriver<
  Driver extends AnySQLiteEventStoreDriver,
> = InferTransactionFromConnection<
  InferDumboConnectionFromEventStoreDriver<Driver>
>;

export type PoolOrConnectionOptions<
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> =
  | ({ pool?: undefined } & InferOptionsFromEventStoreDriver<Driver>)
  | ({ pool: Dumbo } & Partial<InferOptionsFromEventStoreDriver<Driver>>);
