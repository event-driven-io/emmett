import type { SQLMigration } from '@event-driven-io/dumbo';
import {
  migration_0_44_0_cleanupObsoleteCheckpointCompat,
  migration_0_44_0_numericMessageSchemaVersion,
} from './0_44_0.migration';

export const migrations_0_44_0: SQLMigration[] = [
  migration_0_44_0_cleanupObsoleteCheckpointCompat,
  // Double-check before the 0.44.0 release.
  migration_0_44_0_numericMessageSchemaVersion,
];
