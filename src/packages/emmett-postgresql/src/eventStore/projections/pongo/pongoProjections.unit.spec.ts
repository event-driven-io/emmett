import type { Event } from '@event-driven-io/emmett';
import { describe, expectTypeOf, it } from 'vitest';
import type { AnyPostgreSQLEventStoreDriver } from '../..';
import type { PostgreSQLProjectionWithSchema } from '../postgreSQLProjection';
import {
  pongoMultiStreamProjection,
  pongoSingleStreamProjection,
} from './pongoProjections';

type Counted = Event<'Counted', { by: number }>;
type CountDocument = { count: number };

type ExportableProjection = PostgreSQLProjectionWithSchema<
  Counted,
  Counted,
  AnyPostgreSQLEventStoreDriver
>;

const evolve = (
  document: CountDocument | null,
  event: Counted,
): CountDocument => ({ count: (document?.count ?? 0) + event.data.by });

void describe('Pongo projection', () => {
  void describe('created without a driver', () => {
    void it('has a single stream type that libraries can export without annotation', () => {
      const projection = pongoSingleStreamProjection<CountDocument, Counted>({
        collectionName: 'counts',
        canHandle: ['Counted'],
        evolve,
      });

      expectTypeOf(projection).toEqualTypeOf<ExportableProjection>();
    });

    void it('has a multi stream type that libraries can export without annotation', () => {
      const projection = pongoMultiStreamProjection<CountDocument, Counted>({
        collectionName: 'counts',
        canHandle: ['Counted'],
        getDocumentId: (event) => event.metadata.streamName,
        evolve,
      });

      expectTypeOf(projection).toEqualTypeOf<ExportableProjection>();
    });
  });
});
