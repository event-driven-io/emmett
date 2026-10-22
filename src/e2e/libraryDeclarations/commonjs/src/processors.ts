import { projections } from '@event-driven-io/emmett';
import {
  getPostgreSQLEventStore,
  pongoMultiStreamProjection,
  postgreSQLEventStoreConsumer,
  postgreSQLProjector,
  postgreSQLReactor,
  rebuildPostgreSQLProjections,
} from '@event-driven-io/emmett-postgresql';
import { auditProjection, countProjection, type Counted } from './projections';

const connectionString = 'postgresql://localhost:5432/postgres';

export const totalProjection = pongoMultiStreamProjection<{ total: number }, Counted>({
  collectionName: 'totals',
  canHandle: ['Counted'],
  getDocumentId: () => 'total',
  evolve: (document: { total: number } | null, event: Counted) => ({ total: (document?.total ?? 0) + event.data.by }),
});

export const asyncEventStore = getPostgreSQLEventStore(connectionString, {
  projections: projections.async([countProjection, auditProjection]),
});

export const projector = postgreSQLProjector<Counted>({ projection: countProjection, connectionOptions: { connectionString } });

export const reactor = postgreSQLReactor<Counted>({
  processorId: 'audit',
  eachMessage: async () => {},
  connectionOptions: { connectionString },
});

export const standaloneConsumer = postgreSQLEventStoreConsumer<Counted>({ connectionString });

export const standaloneProjector = standaloneConsumer.projector({ projection: countProjection });

export const standaloneReactor = standaloneConsumer.reactor({ processorId: 'audit', eachMessage: async () => {} });

export const rebuild = rebuildPostgreSQLProjections<Counted>({ connectionString, projection: countProjection });
