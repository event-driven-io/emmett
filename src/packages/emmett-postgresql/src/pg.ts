import type { PgPoolOptions } from '@event-driven-io/dumbo/pg';
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';
import type { PostgresEventStoreDriverOptions } from './eventStore';
import type { EventStoreDriver } from './eventStore/eventStoreDriver';

export const pgEventStoreDriver: EventStoreDriver<
  typeof pgDumboDriver,
  PgEventStoreDriverOptions
> = {
  driverType: pgDumboDriver.driverType,
  dumboDriver: pgDumboDriver,
  mapToDumboOptions: (driverOptions) =>
    ({
      driver: pgDumboDriver,
      connectionString: driverOptions.connectionString,
      ...driverOptions.connectionOptions,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    }) as unknown as PgPoolOptions,
};

export type PgEventStoreDriver = typeof pgEventStoreDriver;

/**
 * Connection details reach the driver either as a connection string, or as a
 * whole set of pool options. The second form is what lets a consumer take
 * everything it needs from the driver alone.
 */
export type PgEventStoreDriverOptions =
  | {
      connectionString: string;
      connectionOptions?: PgConnectionOptions;
    }
  | {
      connectionString?: undefined;
      connectionOptions: PgPoolOptions;
    };

/**
 * `Omit` over a union keeps only the keys every member shares, which would drop
 * pool option shapes such as `{ pooled: false }`. Omitting per member keeps
 * them all.
 */
type PgConnectionOptions = PgPoolOptions extends infer Options
  ? Options extends unknown
    ? Omit<Options, 'connectionString'>
    : never
  : never;

export type PgEventStoreOptions =
  PostgresEventStoreDriverOptions<PgEventStoreDriver>;
