import { pgTable, serial, text } from 'drizzle-orm/pg-core';
import type { InferSelectModel } from 'drizzle-orm';
import { assert, type Equals } from './_assert';

const users = pgTable('users', { id: serial().primaryKey(), name: text().notNull() });
type SelectUser = typeof users.$inferSelect;
assert<Equals<SelectUser, InferSelectModel<typeof users>>>();
assert<Equals<SelectUser, { id: number; name: string }>>();
