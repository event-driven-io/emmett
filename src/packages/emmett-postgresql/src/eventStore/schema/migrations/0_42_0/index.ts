import type { SQLMigration } from '@event-driven-io/dumbo';
import {
  migration_0_42_0_2_AddProcessorProjectionFunctions,
  migration_0_42_0_3_FixProcessorLockTimeout,
  migration_0_42_0_FromSubscriptionsToProcessors,
} from './0_42_0.migration';

export const migrations_0_42_0: SQLMigration[] = [
  migration_0_42_0_FromSubscriptionsToProcessors,
  migration_0_42_0_2_AddProcessorProjectionFunctions,
  migration_0_42_0_3_FixProcessorLockTimeout,
];
