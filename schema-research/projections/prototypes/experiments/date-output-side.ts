// Can Emmett tell a field the code wants as a Date from one it wants as an ISO string,
// when both export the same input JSON Schema? Looks at the output side.
import { z } from 'zod';
import * as B from '../../../prototypes/api-ergonomics/styles/b-zod/shoppingCart.js';
import { s } from '../../../prototypes/api-ergonomics/lib/index.js';

const attempt = (label: string, fn: () => unknown) => {
  try {
    console.log(`OK    ${label}:`, JSON.stringify(fn()));
  } catch (error) {
    console.log(`FAIL  ${label}: ${(error as Error).message.split('\n')[0]}`);
  }
};

const int64 = z.codec(z.stringFormat('int64', /^-?\d+$/), z.bigint(), { decode: (v) => BigInt(v), encode: (v) => v.toString() });
const zodSchema = z.object({ asString: z.iso.datetime(), asDate: B.isoDate, total: int64 });
const builderSchema = s.object({ asDate: s.date() });

for (const [label, schema] of Object.entries({ zod: zodSchema, s: builderSchema })) {
  const std = schema['~standard'];
  attempt(`${label} input`, () => std.jsonSchema.input({ target: 'draft-2020-12' }));
  attempt(`${label} output`, () => std.jsonSchema.output({ target: 'draft-2020-12' }));
  attempt(`${label} output, unrepresentable: any`, () =>
    std.jsonSchema.output({ target: 'draft-2020-12', libraryOptions: { unrepresentable: 'any' } }),
  );
}
