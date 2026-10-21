import type { TSchema } from 'typebox';
import Value from 'typebox/value';
export const check = (schema: TSchema, value: unknown) => Value.Check(schema, value);
