import { SQL, sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
import type { EventStoreDatabaseSchemaOptions } from '../../eventStoreDatabaseSchema';
import {
  defaultTag,
  globalTag,
  messagesTable,
  streamsTable,
  tableReference,
} from '../../typing';

const { identifier, literal, plain } = SQL;

const messagesWithTextSchemaVersionTableSQLFor = (
  databaseSchemaName?: string,
) =>
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
  )`;

const metadataSchemaVersion = SQL`json_extract(message_metadata, '$.schemaVersion')`;
const metadataSchemaVersionType = SQL`json_type(message_metadata, '$.schemaVersion')`;

const streamPartitionWrittenBeforeTheFix = '{"name":"partition"}';

export const migration_0_43_0_SQLs: SQL[] = [
  SQL`CREATE TABLE IF NOT EXISTS ${identifier(streamsTable.name)}(
    stream_id         TEXT                      NOT NULL,
    stream_position   BIGINT                    NOT NULL DEFAULT 0,
    partition         TEXT                      NOT NULL DEFAULT '${plain(globalTag)}',
    stream_type       TEXT                      NOT NULL,
    stream_metadata   JSONB                     NOT NULL,
    is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
    PRIMARY KEY (stream_id, partition, is_archived),
    UNIQUE (stream_id, partition, is_archived)
)`,
  SQL`UPDATE ${identifier(streamsTable.name)}
    SET partition = ${literal(defaultTag)}
    WHERE partition = ${literal(streamPartitionWrittenBeforeTheFix)}`,
];

export const migration_0_43_0_FixStreamPartition: SQLMigration = sqlMigration(
  'emt:sqlite:eventstore:0.43.0:fix-stream-partition',
  migration_0_43_0_SQLs,
);

export const migration_0_43_0_numericMessageSchemaVersion_SQLsFor = (
  options?: EventStoreDatabaseSchemaOptions,
): SQL[] => {
  const messages = tableReference(
    options?.databaseSchemaName,
    messagesTable.name,
  );

  return [
    messagesWithTextSchemaVersionTableSQLFor(options?.databaseSchemaName),
    SQL`ALTER TABLE ${messages} ADD COLUMN message_schema_version_int INTEGER NOT NULL DEFAULT 1`,
    SQL`UPDATE ${messages}
    SET message_schema_version_int = CASE
      WHEN ${metadataSchemaVersionType} = 'integer' AND ${metadataSchemaVersion} >= 0
        THEN ${metadataSchemaVersion}
      WHEN ${metadataSchemaVersionType} = 'text'
        AND ${metadataSchemaVersion} GLOB '[0-9]*'
        AND ${metadataSchemaVersion} NOT GLOB '*[^0-9]*'
        THEN CAST(${metadataSchemaVersion} AS INTEGER)
      ELSE 1
    END`,
    SQL`ALTER TABLE ${messages} DROP COLUMN message_schema_version`,
    SQL`ALTER TABLE ${messages} RENAME COLUMN message_schema_version_int TO message_schema_version`,
  ];
};

export const migration_0_43_0_numericMessageSchemaVersionFor = (
  options?: EventStoreDatabaseSchemaOptions,
): SQLMigration =>
  sqlMigration(
    'emt:sqlite:eventstore:0.43.0:numeric-message-schema-version',
    migration_0_43_0_numericMessageSchemaVersion_SQLsFor(options),
  );

export const migration_0_43_0_numericMessageSchemaVersion: SQLMigration =
  migration_0_43_0_numericMessageSchemaVersionFor();
