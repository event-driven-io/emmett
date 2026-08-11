import type { SQLMigration } from '@event-driven-io/dumbo';
import { migration_0_44_0_cleanupObsoleteCheckpointCompat } from './0_44_0.migration';

export const migrations_0_44_0: SQLMigration[] = [
  migration_0_44_0_cleanupObsoleteCheckpointCompat,
];
