import { EmmettError } from '@event-driven-io/emmett';
import type { AnyPongoDriver } from '@event-driven-io/pongo';
import type { PostgreSQLDriverType } from '@event-driven-io/dumbo/pg';
import type {
  AnyDumboDatabaseDriver,
  Connection,
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
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
>(
  driver: Driver | undefined,
): Driver => {
  if (!driver)
    throw new EmmettError(
      `The handler context carries no event store driver. Ensure that you passed it to getPostgreSQLEventStore.`,
    );

  return driver;
};

export const pongoDriverOf = (
  driver: AnyPostgreSQLEventStoreDriver | undefined,
): AnyPongoDriver => {
  const pongoDriver = eventStoreDriverOf(driver).pongoDriver;

  if (!pongoDriver)
    throw new EmmettError(
      `Pongo projections need a Pongo driver on the event store driver. Ensure that the driver you passed to getPostgreSQLEventStore defines 'pongoDriver'.`,
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
 * Mirrors `AnySQLiteConnection`, which Dumbo ships and its PostgreSQL side does
 * not. Move to Dumbo's own once it has one.
 */
export type AnyPostgreSQLConnection = Connection<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  PostgreSQLDriverType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
>;

/**
 * Any driver this package can actually talk to. Constraining on it keeps
 * `context.session.connection` a PostgreSQL connection, whichever PostgreSQL
 * driver you picked.
 */
export type AnyPostgreSQLEventStoreDriver = Omit<
  EventStoreDriver<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    DumboDatabaseDriver<AnyPostgreSQLConnection, any>,
    AnyEventStoreDriverOptions
  >,
  'driverType'
> & { driverType: PostgreSQLDriverType };

export type InferOptionsFromEventStoreDriver<
  C extends AnyPostgreSQLEventStoreDriver,
> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  C extends EventStoreDriver<any, infer DO> ? DO : never;

/**
 * The options `mapToDumboOptions` produces for this driver. A handler context
 * carries them, so a pg user reaches a connection string while a driver
 * without one exposes whatever it does have.
 */
export type InferDumboOptionsFromEventStoreDriver<
  C extends AnyPostgreSQLEventStoreDriver,
> = ExtractDumboDatabaseDriverOptions<C['dumboDriver']>;

export type InferDumboConnectionFromEventStoreDriver<
  Driver extends AnyPostgreSQLEventStoreDriver,
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
  Driver extends AnyPostgreSQLEventStoreDriver,
> = ExtractDumboTypeFromDriver<Driver['dumboDriver']>;

export type InferDbClientFromEventStoreDriver<
  Driver extends AnyPostgreSQLEventStoreDriver,
> = InferDbClientFromConnection<
  InferDumboConnectionFromEventStoreDriver<Driver>
>;

export type InferTransactionFromEventStoreDriver<
  Driver extends AnyPostgreSQLEventStoreDriver,
> = InferTransactionFromConnection<
  InferDumboConnectionFromEventStoreDriver<Driver>
>;

export type PoolOrConnectionOptions<
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
> =
  | ({ pool?: undefined } & InferOptionsFromEventStoreDriver<Driver>)
  | ({ pool: Dumbo } & Partial<InferOptionsFromEventStoreDriver<Driver>>);
