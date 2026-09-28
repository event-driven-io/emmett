import Type from 'typebox';
import { describe, expect, it } from 'vitest';
import {
  toJSONSchema,
  typeBoxSchema,
  validateWithSchema,
} from './standardSchema';

void describe('typeBoxSchema', () => {
  const schema = typeBoxSchema(
    Type.Object({ name: Type.String({ minLength: 1 }) }),
  );

  void it('validates values through Standard Schema', async () => {
    expect(await validateWithSchema(schema, { name: 'a' })).toEqual({
      value: { name: 'a' },
    });
    expect(await validateWithSchema(schema, { name: '' })).toEqual({
      issues: [{ message: expect.any(String) as string, path: ['name'] }],
    });
  });

  void it('exposes the JSON Schema through Standard JSON Schema', () => {
    expect(toJSONSchema(schema)).toEqual({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', minLength: 1 } },
    });
  });
});
