import { SQL, sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
import { defaultTag, globalTag, streamsTable } from '../../typing';

const { identifier, literal, plain } = SQL;

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
