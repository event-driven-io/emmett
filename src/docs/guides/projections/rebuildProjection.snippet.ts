import { SQL } from '@event-driven-io/dumbo';
import {
  postgreSQLRawSQLProjection,
  rebuildPostgreSQLProjections,
} from '@event-driven-io/emmett-postgresql';

const connectionString = 'dummy-connection-string';
const projection = postgreSQLRawSQLProjection({
  canHandle: ['EventType'],
  evolve: () => SQL`SELECT 1`,
  name: 'TestProjection',
});

// #region rebuild-projection
const consumer = rebuildPostgreSQLProjections({
  connectionString,
  projection,
});

await consumer.start();
// #endregion rebuild-projection
