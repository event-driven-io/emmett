import type { Dumbo } from '@event-driven-io/dumbo';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite';
import { pongoDriver as sqlite3PongoDriver } from '@event-driven-io/pongo/sqlite3';
import type {
  SQLite3Connection,
  SQLite3DumboOptions,
  SQLiteAmbientConnectionPool,
  SQLiteTransaction,
  SQLiteTransactionOptions,
} from '@event-driven-io/dumbo/sqlite3';
import { assertThrows, assertTrue, EmmettError } from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import type { D1EventStoreDriver } from '../cloudflare';
import {
  sqlite3EventStoreDriver,
  type SQLite3EventStoreDriver,
} from '../sqlite3';
import type { SQLiteProcessorHandlerContext } from './consumers/sqliteProcessor';
import {
  eventStoreDriverOf,
  pongoDriverOf,
  type AnySQLiteEventStoreDriver,
  type PoolOrConnectionOptions,
} from './eventStoreDriver';
import type { SQLiteProjectionHandlerContext } from './projections/sqliteProjection';

type Equals<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2
    ? true
    : false;

const assertTypesEqual = <_Assertion extends true>(): void => {};

type ProcessorSession<Driver extends AnySQLiteEventStoreDriver> =
  SQLiteProcessorHandlerContext<Driver>['session'];

type ProjectionSession<Driver extends AnySQLiteEventStoreDriver> =
  SQLiteProjectionHandlerContext<Driver>['session'];

type ProcessorConnection<Driver extends AnySQLiteEventStoreDriver> =
  ProcessorSession<Driver>['connection'];

type ProjectionConnection<Driver extends AnySQLiteEventStoreDriver> =
  ProjectionSession<Driver>['connection'];

void describe('Handler context session typing', () => {
  void it('keeps the connection a SQLite one when no driver is given', () => {
    assertTypesEqual<
      ProcessorConnection<AnySQLiteEventStoreDriver> extends AnySQLiteConnection
        ? true
        : false
    >();
    assertTypesEqual<
      ProjectionConnection<AnySQLiteEventStoreDriver> extends AnySQLiteConnection
        ? true
        : false
    >();

    assertTrue(true);
  });

  void it('derives the connection from the driver it was given', () => {
    assertTypesEqual<
      ProcessorConnection<SQLite3EventStoreDriver> extends SQLite3Connection
        ? true
        : false
    >();
    assertTypesEqual<
      ProjectionConnection<SQLite3EventStoreDriver> extends SQLite3Connection
        ? true
        : false
    >();

    assertTrue(true);
  });

  void it('derives the transaction from the driver it was given', () => {
    assertTypesEqual<
      Equals<
        ProcessorSession<SQLite3EventStoreDriver>['transaction'],
        SQLiteTransaction<SQLite3Connection, SQLiteTransactionOptions>
      >
    >();
    assertTypesEqual<
      Equals<
        ProjectionSession<SQLite3EventStoreDriver>['transaction'],
        SQLiteTransaction<SQLite3Connection, SQLiteTransactionOptions>
      >
    >();

    assertTrue(true);
  });

  void it('derives the pool from the driver it was given', () => {
    assertTypesEqual<
      Equals<
        ProcessorSession<SQLite3EventStoreDriver>['pool'],
        SQLiteAmbientConnectionPool<SQLite3Connection>
      >
    >();
    assertTypesEqual<
      Equals<
        ProjectionSession<SQLite3EventStoreDriver>['pool'],
        SQLiteAmbientConnectionPool<SQLite3Connection>
      >
    >();

    assertTrue(true);
  });

  void it('derives the connection options from the driver it was given', () => {
    assertTypesEqual<
      Equals<
        ProcessorSession<SQLite3EventStoreDriver>['connectionOptions'],
        SQLite3DumboOptions | undefined
      >
    >();

    assertTrue(true);
  });

  void it('names the driver type the driver declares', () => {
    assertTypesEqual<
      SQLite3EventStoreDriver['driverType'] extends 'SQLite:sqlite3'
        ? true
        : false
    >();

    assertTrue(true);
  });

  void it('accepts every driver this package ships', () => {
    assertTypesEqual<
      SQLite3EventStoreDriver extends AnySQLiteEventStoreDriver ? true : false
    >();
    assertTypesEqual<
      D1EventStoreDriver extends AnySQLiteEventStoreDriver ? true : false
    >();

    assertTrue(true);
  });

  void it('rejects a driver that is not a SQLite one', () => {
    type NotSQLite = {
      driverType: 'PostgreSQL:pg';
      dumboDriver: never;
      mapToDumboOptions: () => never;
    };

    assertTypesEqual<
      NotSQLite extends AnySQLiteEventStoreDriver ? false : true
    >();

    assertTrue(true);
  });
});

void describe('pongoDriverOf', () => {
  void it('returns the Pongo driver the event store driver names', () => {
    assertTrue(pongoDriverOf(sqlite3EventStoreDriver) === sqlite3PongoDriver);
  });

  void it('fails when the event store driver names no Pongo driver', () => {
    const { pongoDriver: _, ...withoutPongoDriver } = sqlite3EventStoreDriver;

    assertThrows(
      () => pongoDriverOf(withoutPongoDriver),
      (error) => error instanceof EmmettError,
    );
  });
});

void describe('eventStoreDriverOf', () => {
  void it('returns the driver the context was given', () => {
    assertTrue(
      eventStoreDriverOf(sqlite3EventStoreDriver) === sqlite3EventStoreDriver,
    );
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
        fileName: string;
      } extends PoolOrConnectionOptions<SQLite3EventStoreDriver>
        ? true
        : false
    >();
    assertTypesEqual<
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {} extends PoolOrConnectionOptions<SQLite3EventStoreDriver> ? false : true
    >();

    assertTrue(true);
  });

  void it('makes the driver options optional when a pool is given', () => {
    assertTypesEqual<
      { pool: Dumbo } extends PoolOrConnectionOptions<SQLite3EventStoreDriver>
        ? true
        : false
    >();

    assertTrue(true);
  });
});
