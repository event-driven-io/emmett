import { SQL, type AnyDatabaseTransaction } from '@event-driven-io/dumbo';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite';
import type { SQLiteEventStoreOptions } from '../SQLiteEventStore';
import { migration_0_42_0_FromSubscriptionsToProcessors } from './migrations';
import {
  globalTag,
  messagesTable,
  processorsTable,
  projectionsTable,
  streamsTable,
  unknownTag,
} from './typing';

const { identifier, plain } = SQL;

export const streamsTableSQL = SQL`CREATE TABLE IF NOT EXISTS ${identifier(streamsTable.name)}(
      stream_id         TEXT                      NOT NULL,
      stream_position   BIGINT                    NOT NULL DEFAULT 0,
      partition         TEXT                      NOT NULL DEFAULT '${plain(globalTag)}',
      stream_type       TEXT                      NOT NULL,
      stream_metadata   JSONB                     NOT NULL,
      is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
      PRIMARY KEY (stream_id, partition, is_archived),
      UNIQUE (stream_id, partition, is_archived)
  );`;

export const messagesTableSQL = SQL`CREATE TABLE IF NOT EXISTS ${identifier(messagesTable.name)}(
      stream_id              TEXT                      NOT NULL,
      stream_position        BIGINT                    NOT NULL,
      partition              TEXT                      NOT NULL DEFAULT '${plain(globalTag)}',
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
`;

export const processorsTableSQL = SQL`
  CREATE TABLE IF NOT EXISTS ${SQL.identifier(processorsTable.name)}(
      processor_id                 TEXT                  NOT NULL,
      version                      INTEGER               NOT NULL DEFAULT 1,
      partition                    TEXT                  NOT NULL DEFAULT '${plain(globalTag)}',
      status                       TEXT                  NOT NULL DEFAULT 'stopped',
      last_processed_checkpoint    TEXT                  NOT NULL,
      processor_instance_id        TEXT                  DEFAULT '${plain(unknownTag)}',
      PRIMARY KEY (processor_id, partition, version)
  );
`;

export const projectionsTableSQL = SQL`
  CREATE TABLE IF NOT EXISTS ${SQL.identifier(projectionsTable.name)}(
      name                         TEXT                  NOT NULL,
      version                      INTEGER               NOT NULL DEFAULT 1,
      partition                    TEXT                  NOT NULL DEFAULT '${plain(globalTag)}',
      type                         CHAR(1)               NOT NULL,
      kind                         TEXT                  NOT NULL,
      status                       TEXT                  NOT NULL,
      definition                   JSONB                 NOT NULL DEFAULT '{}',
      PRIMARY KEY (name, partition, version)
  );
`;

export const schemaSQL: SQL[] = [
  streamsTableSQL,
  messagesTableSQL,
  processorsTableSQL,
  projectionsTableSQL,
];

export const createEventStoreSchema = async (
  pool: AnySQLiteConnection,
  hooks?: SQLiteEventStoreOptions['hooks'],
): Promise<void> => {
  await pool.withTransaction(async (tx: AnyDatabaseTransaction) => {
    await migration_0_42_0_FromSubscriptionsToProcessors(tx.execute);

    if (hooks?.onBeforeSchemaCreated) {
      await hooks.onBeforeSchemaCreated({
        connection: tx.connection as AnySQLiteConnection,
      });
    }
    await tx.execute.batchCommand(schemaSQL);

    if (hooks?.onAfterSchemaCreated) {
      await hooks.onAfterSchemaCreated();
    }
  });
};
