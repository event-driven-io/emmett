import { SQL } from '@event-driven-io/dumbo';
import type { Event } from '@event-driven-io/emmett';
import { describe, expectTypeOf, it } from 'vitest';
import type { AnyPostgreSQLEventStoreDriver } from '..';
import {
  postgreSQLProjection,
  postgreSQLRawBatchSQLProjection,
  postgreSQLRawSQLProjection,
  type PostgreSQLProjectionDefinition,
} from './postgreSQLProjection';

type Counted = Event<'Counted', { by: number }>;

type ExportableProjection = PostgreSQLProjectionDefinition<
  Counted,
  Counted,
  AnyPostgreSQLEventStoreDriver
>;

void describe('PostgreSQL projection', () => {
  void describe('created without a driver', () => {
    void it('has a type that libraries can export without annotation', () => {
      const projection = postgreSQLProjection<Counted>({
        name: 'counts',
        canHandle: ['Counted'],
        handle: async () => {},
      });

      expectTypeOf(projection).toEqualTypeOf<ExportableProjection>();
    });

    void it('has a raw SQL type that libraries can export without annotation', () => {
      const projection = postgreSQLRawSQLProjection<Counted>({
        name: 'audit',
        canHandle: ['Counted'],
        evolve: (event) =>
          SQL`INSERT INTO audit (by) VALUES (${event.data.by})`,
      });

      expectTypeOf(projection).toEqualTypeOf<ExportableProjection>();
    });

    void it('has a raw batch SQL type that libraries can export without annotation', () => {
      const projection = postgreSQLRawBatchSQLProjection<Counted>({
        name: 'audit',
        canHandle: ['Counted'],
        evolve: (events) =>
          events.map(
            (event) => SQL`INSERT INTO audit (by) VALUES (${event.data.by})`,
          ),
      });

      expectTypeOf(projection).toEqualTypeOf<ExportableProjection>();
    });
  });
});
