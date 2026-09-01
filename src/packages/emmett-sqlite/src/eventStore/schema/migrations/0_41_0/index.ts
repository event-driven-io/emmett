import type { SQLMigration } from '@event-driven-io/dumbo';
import { snapshot_0_41_0 } from './0_41_0.snapshot';

export * from './0_41_0.snapshot';

export const migrations_0_41_0: SQLMigration[] = [snapshot_0_41_0];
