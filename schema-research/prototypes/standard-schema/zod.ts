import * as z from 'zod';
import * as zm from 'zod/mini';
import { inspect, jsonSchemaOf } from './harness.ts';

const isoDatetimeToDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (iso) => new Date(iso),
  encode: (date) => date.toISOString(),
});

const ShoppingCartConfirmed = z
  .object({
    cartId: z.uuid().meta({ description: 'Cart id', examples: ['6f1c2a8e-0b7a-4d43-9a57-1d2c7c6c1f10'] }),
    confirmedAt: isoDatetimeToDate,
    totalAmount: z.number().nonnegative(),
    itemsCount: z.int(),
    status: z.enum(['Confirmed', 'Cancelled']),
    note: z.string().optional().meta({ deprecated: true }),
    discountCode: z.string().nullable(),
    items: z.array(z.object({ productId: z.string(), quantity: z.int().positive() })),
    tags: z.record(z.string(), z.string()),
  })
  .meta({
    id: 'ShoppingCartConfirmed',
    title: 'Shopping cart confirmed',
    description: 'Shopper confirmed the cart',
    'x-emmett-kind': 'Event',
  });

await inspect('zod 4 classic, codec for Date', ShoppingCartConfirmed);

console.log('meta() read back:', JSON.stringify(ShoppingCartConfirmed.meta()));
console.log('globalRegistry.get:', JSON.stringify(z.globalRegistry.get(ShoppingCartConfirmed)));
console.log('shape.cartId meta:', JSON.stringify(ShoppingCartConfirmed.shape.cartId.meta()));

console.log('plain z.date() input JSON Schema:', JSON.stringify(jsonSchemaOf(z.object({ at: z.date() }))));
console.log('z.bigint() input JSON Schema:', JSON.stringify(jsonSchemaOf(z.object({ position: z.bigint() }))));
console.log(
  'z.toJSONSchema bigint with unrepresentable handler:',
  JSON.stringify(
    z.toJSONSchema(z.object({ position: z.bigint() }), {
      unrepresentable: ({ zodSchema }) =>
        zodSchema._zod.def.type === 'bigint' ? { type: 'string', pattern: '^-?[0-9]+$' } : 'throw',
    }),
  ),
);
console.log(
  'transform input vs output:',
  JSON.stringify(jsonSchemaOf(z.object({ amount: z.string().transform(Number) }), 'input')),
  JSON.stringify(jsonSchemaOf(z.object({ amount: z.string().transform(Number) }), 'output')),
);
console.log(
  'stringToBigInt codec input/output:',
  JSON.stringify(jsonSchemaOf(z.codec(z.string(), z.bigint(), { decode: BigInt, encode: String }), 'input')),
  JSON.stringify(jsonSchemaOf(z.codec(z.string(), z.bigint(), { decode: BigInt, encode: String }), 'output')),
);
console.log('encode Date back to wire:', JSON.stringify(z.encode(ShoppingCartConfirmed, ShoppingCartConfirmed.parse({
  cartId: '6f1c2a8e-0b7a-4d43-9a57-1d2c7c6c1f10',
  confirmedAt: '2026-10-04T10:00:00.000Z',
  totalAmount: 1,
  itemsCount: 1,
  status: 'Confirmed',
  discountCode: null,
  items: [],
  tags: {},
}))));

const Mini = zm.object({ cartId: zm.string().check(zm.meta({ description: 'Cart id' })) });
await inspect('zod/mini object', Mini, { cartId: 'a' }, { cartId: 1 });
await inspect('zod/mini via z.toJSONSchema(schema) (StandardJSONSchema wrapper)', zm.toJSONSchema(Mini), { cartId: 'a' }, { cartId: 1 });

type In = z.input<typeof ShoppingCartConfirmed>;
type Out = z.output<typeof ShoppingCartConfirmed>;
const checkIn: In['confirmedAt'] = '2026-10-04T10:00:00.000Z';
const checkOut: Out['confirmedAt'] = new Date();
void checkIn;
void checkOut;
