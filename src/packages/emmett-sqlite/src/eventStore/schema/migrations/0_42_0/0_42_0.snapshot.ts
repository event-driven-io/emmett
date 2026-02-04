import { SQL } from '@event-driven-io/dumbo';

export const schema_0_42_0: SQL[] = [
  SQL`CREATE TABLE IF NOT EXISTS emt_streams(
    stream_id         TEXT                      NOT NULL,
    stream_position   BIGINT                    NOT NULL DEFAULT 0,
    partition         TEXT                      NOT NULL DEFAULT 'global',
    stream_type       TEXT                      NOT NULL,
    stream_metadata   JSONB                     NOT NULL,
    is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
    PRIMARY KEY (stream_id, partition, is_archived),
    UNIQUE (stream_id, partition, is_archived)
)`,
  SQL`CREATE TABLE IF NOT EXISTS emt_messages(
    stream_id              TEXT                      NOT NULL,
    stream_position        BIGINT                    NOT NULL,
    partition              TEXT                      NOT NULL DEFAULT 'global',
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
)`,
  SQL`CREATE TABLE IF NOT EXISTS emt_processors(
    processor_id                 TEXT                  NOT NULL,
    version                      INTEGER               NOT NULL DEFAULT 1,
    partition                    TEXT                  NOT NULL DEFAULT 'global',
    status                       TEXT                  NOT NULL DEFAULT 'stopped',
    last_processed_checkpoint    TEXT                  NOT NULL,
    processor_instance_id        TEXT                  DEFAULT 'emt:unknown',
    PRIMARY KEY (processor_id, partition, version)
)`,
  SQL`CREATE TABLE IF NOT EXISTS emt_projections(
    name                         TEXT                  NOT NULL,
    version                      INTEGER               NOT NULL DEFAULT 1,
    partition                    TEXT                  NOT NULL DEFAULT 'global',
    type                         CHAR(1)               NOT NULL,
    kind                         TEXT                  NOT NULL,
    status                       TEXT                  NOT NULL,
    definition                   JSONB                 NOT NULL DEFAULT '{}',
    PRIMARY KEY (name, partition, version)
)`,
];
