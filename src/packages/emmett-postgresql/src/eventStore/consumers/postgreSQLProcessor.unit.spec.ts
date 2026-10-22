import { SQL } from '@event-driven-io/dumbo';
import type { Event } from '@event-driven-io/emmett';
import { describe, expectTypeOf, it } from 'vitest';
import type { AnyPostgreSQLEventStoreDriver } from '..';
import { postgreSQLRawSQLProjection } from '../projections';
import {
  postgreSQLProjector,
  postgreSQLReactor,
  type PostgreSQLProcessor,
} from './postgreSQLProcessor';

type Counted = Event<'Counted', { by: number }>;

void describe('PostgreSQL processor', () => {
  void describe('created without a driver', () => {
    void it('has a reactor type that libraries can export without annotation', () => {
      const reactor = postgreSQLReactor<Counted>({
        processorId: 'counter',
        eachMessage: () => {},
      });

      expectTypeOf(reactor).toEqualTypeOf<
        PostgreSQLProcessor<Counted, AnyPostgreSQLEventStoreDriver>
      >();
    });

    void it('has a projector type that libraries can export without annotation', () => {
      const projector = postgreSQLProjector<Counted>({
        projection: postgreSQLRawSQLProjection<Counted>({
          name: 'audit',
          canHandle: ['Counted'],
          evolve: (event) =>
            SQL`INSERT INTO audit (by) VALUES (${event.data.by})`,
        }),
      });

      expectTypeOf(projector).toEqualTypeOf<
        PostgreSQLProcessor<Counted, AnyPostgreSQLEventStoreDriver>
      >();
    });
  });
});
