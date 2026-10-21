import type { TSchema } from 'typebox';
import Value from 'typebox/value';
export const errors = (schema: TSchema, value: unknown) => Value.Errors(schema, value).map((e) => e.message);
