import { globalTag, messagesTable, streamsTable } from './typing';

export const sql = (sql: string) => sql;

export const streamsTableSQL = sql(
  `CREATE TABLE IF NOT EXISTS ${streamsTable.name}(
      stream_id         TEXT                      NOT NULL,
      stream_position   BIGINT                    NOT NULL DEFAULT 0,
      partition         TEXT                      NOT NULL DEFAULT '${globalTag}',
      stream_type       TEXT                      NOT NULL,
      stream_metadata   JSONB                     NOT NULL,
      is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
      PRIMARY KEY (stream_id, stream_position, partition, is_archived),
      UNIQUE (stream_id, partition, is_archived)
  );`,
);

export const messagesTableSQL = sql(
  `CREATE TABLE IF NOT EXISTS ${messagesTable.name}(
      stream_id              TEXT                      NOT NULL,
      stream_position        BIGINT                    NOT NULL,
      partition              TEXT                      NOT NULL DEFAULT '${globalTag}',
      message_kind           TEXT                      NOT NULL DEFAULT 'Event',
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
