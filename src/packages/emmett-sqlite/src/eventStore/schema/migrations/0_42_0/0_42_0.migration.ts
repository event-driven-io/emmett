import { singleOrNull, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { globalTag, processorsTable, projectionsTable } from '../../typing';

const { identifier, plain } = SQL;

export const migration_0_42_0_SQLs: SQL[] = [
  SQL`CREATE TABLE IF NOT EXISTS ${identifier(processorsTable.name)}(
    processor_id                 TEXT                  NOT NULL,
    version                      INTEGER               NOT NULL DEFAULT 1,
    partition                    TEXT                  NOT NULL DEFAULT '${plain(globalTag)}',
    status                       TEXT                  NOT NULL DEFAULT 'stopped',
    last_processed_checkpoint    TEXT                  NOT NULL,
    processor_instance_id        TEXT                  DEFAULT 'emt:unknown',
    PRIMARY KEY (processor_id, partition, version)
)`,
  SQL`CREATE TABLE IF NOT EXISTS ${identifier(projectionsTable.name)}(
    name                         TEXT                  NOT NULL,
    version                      INTEGER               NOT NULL DEFAULT 1,
    partition                    TEXT                  NOT NULL DEFAULT '${plain(globalTag)}',
    type                         CHAR(1)               NOT NULL,
    kind                         TEXT                  NOT NULL,
    status                       TEXT                  NOT NULL,
    definition                   JSONB                 NOT NULL DEFAULT '{}',
    PRIMARY KEY (name, partition, version)
)`,
  SQL`INSERT INTO ${identifier(processorsTable.name)}
    (processor_id, version, partition, status, last_processed_checkpoint, processor_instance_id)
  SELECT
    subscription_id,
    version,
    partition,
    'stopped',
    printf('%019d', last_processed_position),
    'emt:unknown'
  FROM emt_subscriptions`,
  SQL`DROP TABLE emt_subscriptions`,
];

export const migration_0_42_0_FromSubscriptionsToProcessors = async (
  execute: SQLExecutor,
): Promise<void> => {
  const tableExists = await singleOrNull(
    execute.query<{ name: string }>(
      SQL`SELECT name FROM sqlite_master WHERE type='table' AND name='emt_subscriptions'`,
    ),
  );

  if (!tableExists) {
    return;
  }

  await execute.batchCommand(migration_0_42_0_SQLs);
};
