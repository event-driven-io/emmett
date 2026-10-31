import { ObjectId } from 'mongodb';
import * as z from 'zod';

const attempt = (label: string, fn: () => unknown) => {
  try {
    console.log(`OK    ${label}:`, JSON.stringify(fn()));
  } catch (error) {
    console.log(`FAIL  ${label}: ${(error as Error).message.split('\n')[0]}`);
  }
};

const withMeta = z.object({ ownerId: z.string().meta({ 'x-emmett-type': 'objectId' }) });
attempt('z.toJSONSchema keeps custom meta key', () => z.toJSONSchema(withMeta));
attempt('~standard.jsonSchema.input keeps custom meta key', () =>
  withMeta['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
);

attempt('z.instanceof(ObjectId) to JSON Schema', () => z.toJSONSchema(z.object({ ownerId: z.instanceof(ObjectId) })));

const objectIdFromString = z.codec(z.string().regex(/^[0-9a-f]{24}$/), z.instanceof(ObjectId), {
  decode: (hex) => new ObjectId(hex),
  encode: (id) => id.toHexString(),
});
const cart = z.object({ ownerId: objectIdFromString });
attempt('codec decode gives ObjectId', () => cart.decode({ ownerId: '64f000000000000000000001' }).ownerId instanceof ObjectId);
attempt('codec encode gives string', () => cart.encode({ ownerId: new ObjectId('64f000000000000000000001') }));
attempt('codec to JSON Schema (input side)', () => z.toJSONSchema(cart, { io: 'input' }));

// A Standard Schema that is not a Zod schema, as an Emmett built-in `objectId()` would be.
const foreignObjectId = {
  '~standard': {
    version: 1 as const,
    vendor: 'emmett',
    validate: (value: unknown) =>
      value instanceof ObjectId ? { value } : { issues: [{ message: 'Expected ObjectId' }] },
  },
};
attempt('non-Zod Standard Schema inside z.object, parse', () =>
  z.object({ ownerId: foreignObjectId }).parse({ ownerId: new ObjectId() }),
);
