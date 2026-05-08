import type { SQLMigration } from '@event-driven-io/dumbo';
import { migration_0_38_7_and_older } from './0_38_7.migration';

export const migrations_0_38_7: SQLMigration[] = [migration_0_38_7_and_older];
