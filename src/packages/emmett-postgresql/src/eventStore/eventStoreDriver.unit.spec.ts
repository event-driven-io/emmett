import type {
  Connection,
  ConnectionPool,
  DatabaseTransaction,
  DumboDatabaseDriver,
} from '@event-driven-io/dumbo';
import type {
  PgClientConnection,
  PgClientOrPoolClient,
  PgPool,
  PgPoolClientConnection,
  PgPoolOptions,
  PgTransactionOptions,
} from '@event-driven-io/dumbo/pg';
import { assertTrue } from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import type { PgEventStoreDriver } from '../pg';
import type { PostgreSQLProcessorHandlerContext } from './consumers/postgreSQLProcessor';
import type { EventStoreDriver } from './eventStoreDriver';
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

type ProcessorConnection<Driver extends EventStoreDriver> =
  PostgreSQLProcessorHandlerContext<Driver>['connection'];

type ProjectionConnection<Driver extends EventStoreDriver> =
  PostgreSQLProjectionHandlerContext<Driver>['connection'];

void describe('Handler context connection typing', () => {
  void describe('when no driver is given', () => {
    void it('falls back to the pg driver', () => {
      assertTypesEqual<
        Equals<
          ProcessorConnection<PgEventStoreDriver>['client'],
          PgClientOrPoolClient
        >
      >();
      assertTypesEqual<
        Equals<ProcessorConnection<PgEventStoreDriver>['pool'], PgPool>
      >();
      assertTypesEqual<
        Equals<
          ProcessorConnection<PgEventStoreDriver>['transaction'],
          | DatabaseTransaction<PgPoolClientConnection, PgTransactionOptions>
          | DatabaseTransaction<PgClientConnection, PgTransactionOptions>
        >
      >();

      assertTypesEqual<
        Equals<
          ProcessorConnection<PgEventStoreDriver>['options'],
          PgPoolOptions
        >
      >();

      assertTrue(true);
    });
  });

  void describe('when another driver is given', () => {
    void it('derives the client from that driver', () => {
      assertTypesEqual<
        Equals<ProcessorConnection<FakeEventStoreDriver>['client'], FakeClient>
      >();
      assertTypesEqual<
        Equals<ProjectionConnection<FakeEventStoreDriver>['client'], FakeClient>
      >();

      assertTrue(true);
    });

    void it('derives the transaction from that driver', () => {
      assertTypesEqual<
        Equals<
          ProcessorConnection<FakeEventStoreDriver>['transaction'],
          DatabaseTransaction<FakeConnection>
        >
      >();

      assertTrue(true);
    });

    void it('derives the pool options from that driver', () => {
      assertTypesEqual<
        Equals<
          ProcessorConnection<FakeEventStoreDriver>['options'],
          { url: string }
        >
      >();

      assertTrue(true);
    });

    void it('derives the pool from that driver', () => {
      assertTypesEqual<
        Equals<
          ProcessorConnection<FakeEventStoreDriver>['pool'],
          ConnectionPool<FakeConnection>
        >
      >();

      assertTrue(true);
    });
  });
});
