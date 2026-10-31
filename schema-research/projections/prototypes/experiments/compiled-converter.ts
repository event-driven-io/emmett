// Generic walk vs converter generated once from the format paths, same schema and formats.
import { z } from 'zod';
import * as B from '../../../prototypes/api-ergonomics/styles/b-zod/shoppingCart.js';
import { mongoDBFormats, objectIdPattern } from '../lib/mongoDBSchema.js';
import { pongoFormats } from '../lib/pongoSchema.js';
import { compiledCodec, documentCodec } from '../lib/projectionSchema.js';

const schema = z.object({
  clientId: z.stringFormat('objectid', objectIdPattern),
  totalAmount: z.number(),
  items: z.array(z.object({ productId: z.string(), addedAt: B.isoDate })),
  confirmedAt: B.isoDate.optional(),
});
const value = {
  clientId: '64f000000000000000000001',
  totalAmount: 100,
  items: Array.from({ length: 10 }, (_, i) => ({ productId: `p${i}`, addedAt: new Date('2026-10-31T09:00:00.000Z') })),
  confirmedAt: new Date('2026-10-31T10:00:00.000Z'),
};

const time = (label: string, run: () => unknown, iterations = 200_000) => {
  for (let i = 0; i < 10_000; i++) run();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) run();
  const ns = Number(process.hrtime.bigint() - start) / iterations;
  console.log(`${label}: ${ns.toFixed(0)} ns per document`);
};

for (const [storage, formats] of Object.entries({ MongoDB: mongoDBFormats, Pongo: pongoFormats })) {
  const walked = documentCodec(schema, formats);
  const compiled = compiledCodec(schema, formats);
  const stored = walked.write(value);
  time(`${storage} write, walked  `, () => walked.write(value));
  time(`${storage} write, compiled`, () => compiled.write(value));
  time(`${storage} read,  walked  `, () => walked.read(stored));
  time(`${storage} read,  compiled`, () => compiled.read(stored));
}
