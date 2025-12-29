import type { SQLiteConnection } from '../../connection';
import type { SQLiteEventStoreOptions } from '../SQLiteEventStore';
import { migration_0_42_0_FromSubscriptionsToProcessors } from './migrations';
import {
  globalTag,
  messagesTable,
  processorsTable,
  projectionsTable,
  streamsTable,
} from './typing';

export const sql = (sql: string) => sql;

export const streamsTableSQL = sql(
  `CREATE TABLE IF NOT EXISTS ${streamsTable.name}(
      stream_id         TEXT                      NOT NULL,
      stream_position   BIGINT                    NOT NULL DEFAULT 0,
      partition         TEXT                      NOT NULL DEFAULT '${globalTag}',
      stream_type       TEXT                      NOT NULL,
      stream_metadata   JSONB                     NOT NULL,
      is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
      PRIMARY KEY (stream_id, partition, is_archived),
      UNIQUE (stream_id, partition, is_archived)
  );`,
);

export const messagesTableSQL = sql(
  `CREATE TABLE IF NOT EXISTS ${messagesTable.name}(
      stream_id              TEXT                      NOT NULL,
      stream_position        BIGINT                    NOT NULL,
      partition              TEXT                      NOT NULL DEFAULT '${globalTag}',
      message_kind           CHAR(1)                   NOT NULL DEFAULT 'E',
      message_data           JSONB                     NOT NULL,
      message_metadata       JSONB                     NOT NULL,
      message_schema_version TEXT                      NOT NULL,
      message_type           TEXT                      NOT NULL,
      message_id             TEXT                      NOT NULL,
      is_archived            BOOLEAN                   NOT NULL DEFAULT FALSE,
      global_position        INTEGER                   PRIMARY KEY,
      created                DATETIME                  DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (stream_id, stream_position, partition, is_archived)
  ); 
`,
);

export const processorsTableSQL = sql(
  `
  CREATE TABLE IF NOT EXISTS ${processorsTable.name}(
      processor_id                 TEXT                  NOT NULL,
      version                      INTEGER               NOT NULL DEFAULT 1,
      partition                    TEXT                  NOT NULL DEFAULT '${globalTag}',
      status                       TEXT                  NOT NULL DEFAULT 'stopped',
      last_processed_checkpoint    TEXT                  NOT NULL,
      processor_instance_id        TEXT                  DEFAULT 'emt:unknown',
      PRIMARY KEY (processor_id, partition, version)
  );
`,
);

export const projectionsTableSQL = sql(
  `
  CREATE TABLE IF NOT EXISTS ${projectionsTable.name}(
      name                         TEXT                  NOT NULL,
      version                      INTEGER               NOT NULL DEFAULT 1,
      partition                    TEXT                  NOT NULL DEFAULT '${globalTag}',
      type                         CHAR(1)               NOT NULL,
      kind                         TEXT                  NOT NULL,
      status                       TEXT                  NOT NULL,
      definition                   JSONB                 NOT NULL DEFAULT '{}',
      PRIMARY KEY (name, partition, version)
  );
`,
);

export const schemaSQL: string[] = [
  streamsTableSQL,
  messagesTableSQL,
  processorsTableSQL,
  projectionsTableSQL,
];

export const createEventStoreSchema = async (
  connection: SQLiteConnection,
  hooks?: SQLiteEventStoreOptions['hooks'],
): Promise<void> => {
  await connection.withTransaction(async () => {
    await migration_0_42_0_FromSubscriptionsToProcessors(connection);

    if (hooks?.onBeforeSchemaCreated) {
      await hooks.onBeforeSchemaCreated({ connection: connection });
    }
    await connection.batchCommand(schemaSQL);
  });

  if (hooks?.onAfterSchemaCreated) {
    await hooks.onAfterSchemaCreated();
  }
};
