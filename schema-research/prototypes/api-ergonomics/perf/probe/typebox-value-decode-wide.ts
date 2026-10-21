import type { TSchema } from 'typebox';
import Value from 'typebox/value';
export const decode = (schema: TSchema, value: unknown): unknown => Value.Decode(schema, value);
