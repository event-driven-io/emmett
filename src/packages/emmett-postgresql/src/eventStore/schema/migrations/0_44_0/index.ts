import type { SQLMigration } from '@event-driven-io/dumbo';
import { migration_0_44_0_cleanupObsoleteCheckpointCompat } from './0_44_0.migration';

export const migrations_0_44_0: SQLMigration[] = [
  migration_0_44_0_cleanupObsoleteCheckpointCompat,
];

// Kept out of migrations_0_44_0: that array is destined for
// pastEventStoreSchemaMigrations, which runs before schemaMigration creates the tables.
// Wired after schemaMigration instead - see ../index.ts.
export { migration_0_44_0_addMessagesPollIndex } from './0_44_0.migration';
