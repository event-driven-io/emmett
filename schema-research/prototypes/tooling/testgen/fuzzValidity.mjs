// Check whether @traversable/zod-test fuzz output always satisfies the source schema.
import fc from 'fast-check';
import { zxTest } from '@traversable/zod-test';
import { z } from 'zod';

const cases = {
  'z.int().positive()': z.int().positive(),
  'z.number().int().positive()': z.number().int().positive(),
  'z.int().min(1)': z.int().min(1),
  'z.number().gt(0)': z.number().gt(0),
  'z.string().min(1)': z.string().min(1),
};
for (const [name, schema] of Object.entries(cases)) {
  const samples = fc.sample(zxTest.fuzz(schema), { numRuns: 2000, seed: 42 });
  const invalid = samples.filter((s) => !schema.safeParse(s).success);
  console.log(`${name}: ${invalid.length}/2000 invalid`, invalid.slice(0, 3));
}
