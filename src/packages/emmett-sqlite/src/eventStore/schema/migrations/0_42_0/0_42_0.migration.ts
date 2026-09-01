import { SQL, sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
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
  // SQLite has no conditional statement, so the legacy table is created empty
  // when it is missing. The copy below then finds no rows and the drop always
  // has a table to remove.
  SQL`CREATE TABLE IF NOT EXISTS emt_subscriptions(
    subscription_id                 TEXT                   NOT NULL,
    version                         INTEGER                NOT NULL DEFAULT 1,
    partition                       TEXT                   NOT NULL DEFAULT '${plain(globalTag)}',
    last_processed_position         BIGINT                 NOT NULL,
    PRIMARY KEY (subscription_id, partition, version)
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

export const migration_0_42_0_FromSubscriptionsToProcessors: SQLMigration =
  sqlMigration(
    'emt:sqlite:eventstore:0.42.0:from-subscriptions-to-processors',
    migration_0_42_0_SQLs,
  );
