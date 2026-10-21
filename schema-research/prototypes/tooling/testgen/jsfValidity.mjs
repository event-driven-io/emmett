// Check whether json-schema-faker output satisfies the zod schema it was exported from.
import { generateSync } from 'json-schema-faker';
import { z } from 'zod';

const cases = {
  'z.int().positive()': z.int().positive(),
  'z.number().gt(0)': z.number().gt(0),
  'z.string().min(1)': z.string().min(1),
  'object with uuid + datetime': z.object({ id: z.uuid(), at: z.iso.datetime(), n: z.int().min(1).max(10) }),
};
for (const [name, schema] of Object.entries(cases)) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  let invalid = 0;
  const examples = [];
  for (let seed = 1; seed <= 2000; seed++) {
    const value = generateSync(json, { seed });
    if (!schema.safeParse(value).success) { invalid++; if (examples.length < 3) examples.push(value); }
  }
  console.log(`${name}: ${invalid}/2000 invalid`, examples);
}
