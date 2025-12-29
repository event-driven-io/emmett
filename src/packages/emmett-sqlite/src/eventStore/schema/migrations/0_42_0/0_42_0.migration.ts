import type { SQLiteConnection } from '../../../../connection';
import { globalTag, processorsTable, projectionsTable } from '../../typing';

export const migration_0_42_0_SQLs: string[] = [
  `CREATE TABLE IF NOT EXISTS ${processorsTable.name}(
    processor_id                 TEXT                  NOT NULL,
    version                      INTEGER               NOT NULL DEFAULT 1,
    partition                    TEXT                  NOT NULL DEFAULT '${globalTag}',
    status                       TEXT                  NOT NULL DEFAULT 'stopped',
    last_processed_checkpoint    TEXT                  NOT NULL,
    processor_instance_id        TEXT                  DEFAULT 'emt:unknown',
    PRIMARY KEY (processor_id, partition, version)
)`,
  `CREATE TABLE IF NOT EXISTS ${projectionsTable.name}(
    name                         TEXT                  NOT NULL,
    version                      INTEGER               NOT NULL DEFAULT 1,
    partition                    TEXT                  NOT NULL DEFAULT '${globalTag}',
    type                         CHAR(1)               NOT NULL,
    kind                         TEXT                  NOT NULL,
    status                       TEXT                  NOT NULL,
    definition                   JSONB                 NOT NULL DEFAULT '{}',
    PRIMARY KEY (name, partition, version)
)`,
  `INSERT INTO ${processorsTable.name}
    (processor_id, version, partition, status, last_processed_checkpoint, processor_instance_id)
  SELECT
    subscription_id,
    version,
    partition,
    'stopped',
    printf('%019d', last_processed_position),
    'emt:unknown'
  FROM emt_subscriptions`,
  `DROP TABLE emt_subscriptions`,
];

export const migration_0_42_0_FromSubscriptionsToProcessors = async (
  connection: SQLiteConnection,
): Promise<void> => {
  await connection.withTransaction(async () => {
    const tableExists = await connection.querySingle<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='emt_subscriptions'",
    );

    if (!tableExists) {
      return;
    }

    await connection.batchCommand(migration_0_42_0_SQLs);
  });
};
