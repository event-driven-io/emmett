import type {
  AnyDumboDatabaseDriver,
  ExtractDumboDatabaseDriverOptions,
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
    | ExtractDumboDatabaseDriverOptions<Driver['dumboDriver']>
    | undefined;
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
