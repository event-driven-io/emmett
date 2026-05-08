import type { SQLMigration } from '@event-driven-io/dumbo';
import { migration_0_43_0_cleanupLegacySubscription } from './0_43_0.migration';

export const migrations_0_43_0: SQLMigration[] = [
  migration_0_43_0_cleanupLegacySubscription,
];
