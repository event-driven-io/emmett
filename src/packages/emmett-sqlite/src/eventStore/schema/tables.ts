import { SQL } from '@event-driven-io/dumbo';
import {
  globalTag,
  messagesTable,
  processorsTable,
  projectionsTable,
  streamsTable,
  tableReference,
  unknownTag,
} from './typing';

const { plain } = SQL;

export const streamsTableSQLFor = (databaseSchemaName?: string) =>
  SQL`CREATE TABLE IF NOT EXISTS ${tableReference(databaseSchemaName, streamsTable.name)}(
      stream_id         TEXT                      NOT NULL,
      stream_position   BIGINT                    NOT NULL DEFAULT 0,
      partition         TEXT                      NOT NULL DEFAULT '${plain(globalTag)}',
      stream_type       TEXT                      NOT NULL,
      stream_metadata   JSONB                     NOT NULL,
      is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
      PRIMARY KEY (stream_id, partition, is_archived),
      UNIQUE (stream_id, partition, is_archived)
  );`;

export const streamsTableSQL = streamsTableSQLFor();

export const messagesTableSQLFor = (databaseSchemaName?: string) =>
  SQL`CREATE TABLE IF NOT EXISTS ${tableReference(databaseSchemaName, messagesTable.name)}(
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

export const messagesTableSQL = messagesTableSQLFor();

export const processorsTableSQLFor = (databaseSchemaName?: string) => SQL`
  CREATE TABLE IF NOT EXISTS ${tableReference(databaseSchemaName, processorsTable.name)}(
      processor_id                 TEXT                  NOT NULL,
      version                      INTEGER               NOT NULL DEFAULT 1,
      partition                    TEXT                  NOT NULL DEFAULT '${plain(globalTag)}',
      status                       TEXT                  NOT NULL DEFAULT 'stopped',
      last_processed_checkpoint    TEXT                  NOT NULL,
      processor_instance_id        TEXT                  DEFAULT '${plain(unknownTag)}',
      PRIMARY KEY (processor_id, partition, version)
  );
`;

export const processorsTableSQL = processorsTableSQLFor();

export const projectionsTableSQLFor = (databaseSchemaName?: string) => SQL`
  CREATE TABLE IF NOT EXISTS ${tableReference(databaseSchemaName, projectionsTable.name)}(
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

export const projectionsTableSQL = projectionsTableSQLFor();
