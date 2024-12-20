
import { eventsTable, globalTag, streamsTable } from './typing';

export const sql = (sql: string) => sql;

export const streamsTableSQL = sql(
  `CREATE TABLE IF NOT EXISTS ${streamsTable.name}(
      stream_id         TEXT                      NOT NULL,
      stream_position   BIGINT                    NOT NULL DEFAULT 0,
      partition         TEXT                      NOT NULL DEFAULT '${globalTag}__${globalTag}',
      stream_type       TEXT                      NOT NULL,
      stream_metadata   JSONB                     NOT NULL,
      is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
      PRIMARY KEY (stream_id, stream_position, partition, is_archived),
      UNIQUE (stream_id, partition, is_archived)
  );`
);

export const eventsTableSQL = sql(
  `CREATE TABLE IF NOT EXISTS ${eventsTable.name}(
      stream_id              TEXT                      NOT NULL,
      stream_position        BIGINT                    NOT NULL,
      partition              TEXT                      NOT NULL DEFAULT '${globalTag}',
      event_data             JSONB                     NOT NULL,
      event_metadata         JSONB                     NOT NULL,
      event_schema_version   TEXT                      NOT NULL,
      event_type             TEXT                      NOT NULL,
      event_id               TEXT                      NOT NULL,
      is_archived            BOOLEAN                   NOT NULL DEFAULT FALSE,
      global_position        BIGINT                    ,
      created                DATETIME                  DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (stream_id, stream_position, partition, is_archived)
  ); 
`);

