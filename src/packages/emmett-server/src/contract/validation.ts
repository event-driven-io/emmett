import { Schemas, type JSONSchema } from './schemas';

export type SchemaValidationError = { path: string; message: string };

const typeOf = (value: unknown): JSONSchema['type'] => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number')
    return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value as JSONSchema['type'];
};

const resolve = (schema: JSONSchema): JSONSchema => {
  if (!schema.$ref) return schema;

  const name = schema.$ref.replace('#/components/schemas/', '');
  const resolved = (Schemas as Record<string, JSONSchema>)[name];
  if (!resolved) throw new Error(`Unknown schema reference ${schema.$ref}`);

  return resolved;
};

/**
 * Validates a value against the subset of JSON Schema used by the Event Store API contract.
 * It interprets schemas without generating code, so it also runs where `eval` is forbidden.
 */
export const validateAgainstSchema = (
  value: unknown,
  schema: JSONSchema,
  path = '',
): SchemaValidationError[] => {
  const current = resolve(schema);
  const errors: SchemaValidationError[] = [];
  const at = path === '' ? '/' : path;

  for (const part of current.allOf ?? [])
    errors.push(...validateAgainstSchema(value, part, path));

  const actualType = typeOf(value);

  if (current.type !== undefined) {
    const matches =
      current.type === actualType ||
      (current.type === 'number' && actualType === 'integer');

    if (!matches) {
      errors.push({ path: at, message: `must be of type ${current.type}` });
      return errors;
    }
  }

  if (current.enum && !current.enum.includes(value as string))
    errors.push({
      path: at,
      message: `must be one of ${current.enum.join(', ')}`,
    });

  if (typeof value === 'string') {
    if (current.minLength !== undefined && value.length < current.minLength)
      errors.push({
        path: at,
        message: `must have at least ${current.minLength} character(s)`,
      });
    if (
      current.pattern !== undefined &&
      !new RegExp(current.pattern).test(value)
    )
      errors.push({ path: at, message: `must match ${current.pattern}` });
  }

  if (Array.isArray(value)) {
    if (current.minItems !== undefined && value.length < current.minItems)
      errors.push({
        path: at,
        message: `must have at least ${current.minItems} item(s)`,
      });
    if (current.items)
      value.forEach((item, index) =>
        errors.push(
          ...validateAgainstSchema(item, current.items!, `${path}/${index}`),
        ),
      );
  }

  if (actualType === 'object') {
    const record = value as Record<string, unknown>;

    for (const property of current.required ?? [])
      if (record[property] === undefined)
        errors.push({ path: `${path}/${property}`, message: 'is required' });

    for (const [property, propertySchema] of Object.entries(
      current.properties ?? {},
    ))
      if (record[property] !== undefined)
        errors.push(
          ...validateAgainstSchema(
            record[property],
            propertySchema,
            `${path}/${property}`,
          ),
        );
  }

  return errors;
};
