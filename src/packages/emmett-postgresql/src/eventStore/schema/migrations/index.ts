import type { SQLMigration } from '@event-driven-io/dumbo';
import { migrations_0_42_0 } from './0_42_0';
import { migrations_0_43_0 } from './0_43_0';
import { migrations_0_38_7 } from './0_38_7';

export const pastEventStoreSchemaMigrations: SQLMigration[] = [
  ...migrations_0_38_7,
  ...migrations_0_42_0,
  ...migrations_0_43_0,
];
