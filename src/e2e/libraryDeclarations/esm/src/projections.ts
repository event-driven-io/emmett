import { SQL } from '@event-driven-io/dumbo';
import { pongoSingleStreamProjection, postgreSQLRawSQLProjection } from '@event-driven-io/emmett-postgresql';

export type Counted = { type: 'Counted'; data: { by: number } };
type CountDocument = { count: number };

export const countProjection = pongoSingleStreamProjection<CountDocument, Counted>({
  collectionName: 'counts',
  version: 1,
  canHandle: ['Counted'],
  getDocumentId: (event) => event.metadata.streamName,
  evolve: (document: CountDocument | null, event: Counted) => ({ count: (document?.count ?? 0) + event.data.by }),
});

export const auditProjection = postgreSQLRawSQLProjection<Counted>({
  name: 'audit',
  canHandle: ['Counted'],
  evolve: (event) => SQL`INSERT INTO audit (by) VALUES (${event.data.by})`,
});
