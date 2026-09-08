import type {
  Connection,
  ConnectionPool,
  Dumbo,
  DatabaseTransaction,
  DumboDatabaseDriver,
} from '@event-driven-io/dumbo';
import type {
  PgClientConnection,
  PgPool,
  PgPoolClientConnection,
  PgPoolOptions,
  PgTransactionOptions,
} from '@event-driven-io/dumbo/pg';
import { assertThrows, assertTrue, EmmettError } from '@event-driven-io/emmett';
import { pgDriver as pgPongoDriver } from '@event-driven-io/pongo/pg';
import { describe, it } from 'vitest';
import { pgEventStoreDriver, type PgEventStoreDriver } from '../pg';
import type { PostgreSQLProcessorHandlerContext } from './consumers/postgreSQLProcessor';
import {
  eventStoreDriverOf,
  pongoDriverOf,
  type AnyPostgreSQLEventStoreDriver,
  type EventStoreDriver,
  type PoolOrConnectionOptions,
} from './eventStoreDriver';
import type { PostgreSQLProjectionHandlerContext } from './projections/postgreSQLProjection';

type Equals<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2
    ? true
    : false;

const assertTypesEqual = <_Assertion extends true>(): void => {};

type FakeClient = { readonly fakeClient: unique symbol };

type FakeConnection = Connection<
  FakeConnection,
  'PostgreSQL:fake',
  FakeClient,
  DatabaseTransaction<FakeConnection>
>;

type FakeDumboDriver = DumboDatabaseDriver<
  FakeConnection,
  { url: string },
  ConnectionPool<FakeConnection>
>;

type FakeEventStoreDriver = EventStoreDriver<
  FakeDumboDriver,
  { connectionOptions?: { url: string } | undefined }
>;

type ProcessorSession<Driver extends AnyPostgreSQLEventStoreDriver> =
  PostgreSQLProcessorHandlerContext<Driver>['session'];

type ProjectionSession<Driver extends AnyPostgreSQLEventStoreDriver> =
  PostgreSQLProjectionHandlerContext<Driver>['session'];

void describe('Handler context session typing', () => {
  void describe('when no driver is given', () => {
    void it('falls back to the pg driver', () => {
      assertTypesEqual<
        Equals<
          ProcessorSession<PgEventStoreDriver>['connection'],
          PgClientConnection | PgPoolClientConnection
        >
      >();
      assertTypesEqual<
        Equals<ProcessorSession<PgEventStoreDriver>['pool'], PgPool>
      >();
      assertTypesEqual<
        Equals<
          ProcessorSession<PgEventStoreDriver>['transaction'],
          | DatabaseTransaction<PgPoolClientConnection, PgTransactionOptions>
          | DatabaseTransaction<PgClientConnection, PgTransactionOptions>
        >
      >();

      assertTypesEqual<
        Equals<
          ProcessorSession<PgEventStoreDriver>['connectionOptions'],
          PgPoolOptions | undefined
        >
      >();

      assertTrue(true);
    });
  });

  void describe('when another driver is given', () => {
    void it('derives the connection from that driver', () => {
      assertTypesEqual<
        Equals<
          ProcessorSession<FakeEventStoreDriver>['connection'],
          FakeConnection
        >
      >();
      assertTypesEqual<
        Equals<
          ProjectionSession<FakeEventStoreDriver>['connection'],
          FakeConnection
        >
      >();

      assertTrue(true);
    });

    void it('derives the transaction from that driver', () => {
      assertTypesEqual<
        Equals<
          ProcessorSession<FakeEventStoreDriver>['transaction'],
          DatabaseTransaction<FakeConnection>
        >
      >();

      assertTrue(true);
    });

    void it('derives the pool options from that driver', () => {
      assertTypesEqual<
        Equals<
          ProcessorSession<FakeEventStoreDriver>['connectionOptions'],
          { url: string } | undefined
        >
      >();

      assertTrue(true);
    });

    void it('derives the pool from that driver', () => {
      assertTypesEqual<
        Equals<
          ProcessorSession<FakeEventStoreDriver>['pool'],
          ConnectionPool<FakeConnection>
        >
      >();

      assertTrue(true);
    });
  });

  void describe('driver family', () => {
    void it('accepts every driver this package ships', () => {
      assertTypesEqual<
        PgEventStoreDriver extends AnyPostgreSQLEventStoreDriver ? true : false
      >();

      assertTrue(true);
    });

    void it('rejects a driver that is not a PostgreSQL one', () => {
      type NotPostgreSQL = {
        driverType: 'SQLite:sqlite3';
        dumboDriver: never;
        mapToDumboOptions: () => never;
      };

      assertTypesEqual<
        NotPostgreSQL extends AnyPostgreSQLEventStoreDriver ? false : true
      >();

      assertTrue(true);
    });
  });
});

void describe('pongoDriverOf', () => {
  void it('returns the Pongo driver the event store driver names', () => {
    assertTrue(pongoDriverOf(pgEventStoreDriver) === pgPongoDriver);
  });

  void it('fails when the event store driver names no Pongo driver', () => {
    const { pongoDriver: _, ...withoutPongoDriver } = pgEventStoreDriver;

    assertThrows(
      () => pongoDriverOf(withoutPongoDriver),
      (error) => error instanceof EmmettError,
    );
  });
});

void describe('eventStoreDriverOf', () => {
  void it('returns the driver the context was given', () => {
    assertTrue(eventStoreDriverOf(pgEventStoreDriver) === pgEventStoreDriver);
  });

  void it('fails when the context carries no driver', () => {
    assertThrows(
      () => eventStoreDriverOf(undefined),
      (error) => error instanceof EmmettError,
    );
  });
});

void describe('PoolOrConnectionOptions', () => {
  void it('needs the driver options when no pool is given', () => {
    assertTypesEqual<
      {
        connectionString: string;
      } extends PoolOrConnectionOptions<PgEventStoreDriver>
        ? true
        : false
    >();
    assertTypesEqual<
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {} extends PoolOrConnectionOptions<PgEventStoreDriver> ? false : true
    >();

    assertTrue(true);
  });

  void it('makes the driver options optional when a pool is given', () => {
    assertTypesEqual<
      { pool: Dumbo } extends PoolOrConnectionOptions<PgEventStoreDriver>
        ? true
        : false
    >();

    assertTrue(true);
  });
});
