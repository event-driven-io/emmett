import type { SQLMigration } from '@event-driven-io/dumbo';
import { migration_0_42_0_FromSubscriptionsToProcessors } from './0_42_0.migration';

export * from './0_42_0.migration';
export * from './0_42_0.snapshot';

export const migrations_0_42_0: SQLMigration[] = [
  migration_0_42_0_FromSubscriptionsToProcessors,
];
