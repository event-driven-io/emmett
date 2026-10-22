import { projections } from '@event-driven-io/emmett';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { auditProjection, countProjection, type Counted } from './projections.js';

export const eventStore = getPostgreSQLEventStore('postgresql://localhost:5432/postgres', {
  projections: projections.inline([countProjection, auditProjection]),
});

export const consumer = eventStore.consumer<Counted>();

consumer.projector({ processorId: 'count', projection: countProjection });
