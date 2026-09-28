import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from '@standard-schema/spec';
import type { Static, TSchema } from 'typebox';
import Value from 'typebox/value';

/**
 * Schema accepted by the Event Store API contract: any Standard Schema
 * implementation that also implements Standard JSON Schema, so it can both
 * validate values and describe them in OpenAPI.
 */
export type ContractSchema<Output = unknown> = StandardSchemaV1<
  unknown,
  Output
> &
  StandardJSONSchemaV1<unknown, Output>;

const pathOf = (instancePath: string) =>
  instancePath
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));

/**
 * Exposes a TypeBox schema through Standard Schema and Standard JSON Schema.
 * Validation interprets the schema, so it also runs where `eval` is forbidden.
 */
export const typeBoxSchema = <Schema extends TSchema>(
  schema: Schema,
): ContractSchema<Static<Schema>> => ({
  '~standard': {
    version: 1,
    vendor: 'typebox',
    validate: (value) =>
      Value.Check(schema, value)
        ? { value: value }
        : {
            issues: [...Value.Errors(schema, value)].map((error) => ({
              message: error.message,
              path: pathOf(error.instancePath),
            })),
          },
    jsonSchema: {
      input: () => schema as Record<string, unknown>,
      output: () => schema as Record<string, unknown>,
    },
  },
});

export const toJSONSchema = (
  schema: StandardJSONSchemaV1,
): Record<string, unknown> =>
  schema['~standard'].jsonSchema.output({ target: 'draft-2020-12' });

export const validateWithSchema = async <Output>(
  schema: StandardSchemaV1<unknown, Output>,
  value: unknown,
): Promise<StandardSchemaV1.Result<Output>> =>
  schema['~standard'].validate(value);
