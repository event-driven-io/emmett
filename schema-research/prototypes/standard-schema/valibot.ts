import * as v from 'valibot';
import { toJsonSchema, toStandardJsonSchema } from '@valibot/to-json-schema';
import { inspect, jsonSchemaOf } from './harness.ts';

const ShoppingCartConfirmed = v.pipe(
  v.object({
    cartId: v.pipe(v.string(), v.uuid(), v.description('Cart id'), v.examples(['6f1c2a8e-0b7a-4d43-9a57-1d2c7c6c1f10'])),
    confirmedAt: v.pipe(v.string(), v.isoTimestamp(), v.transform((iso) => new Date(iso)), v.date()),
    totalAmount: v.pipe(v.number(), v.minValue(0)),
    itemsCount: v.pipe(v.number(), v.integer()),
    status: v.picklist(['Confirmed', 'Cancelled']),
    note: v.optional(v.pipe(v.string(), v.metadata({ deprecated: true }))),
    discountCode: v.nullable(v.string()),
    items: v.array(v.object({ productId: v.string(), quantity: v.pipe(v.number(), v.integer(), v.minValue(1)) })),
    tags: v.record(v.string(), v.string()),
  }),
  v.title('Shopping cart confirmed'),
  v.description('Shopper confirmed the cart'),
  v.metadata({ 'x-emmett-kind': 'Event' }),
);

await inspect('valibot raw schema', ShoppingCartConfirmed);
const standard = toStandardJsonSchema(ShoppingCartConfirmed);
await inspect('valibot toStandardJsonSchema(schema)', standard);

console.log('getTitle:', v.getTitle(ShoppingCartConfirmed));
console.log('getDescription:', v.getDescription(ShoppingCartConfirmed));
console.log('getMetadata:', JSON.stringify(v.getMetadata(ShoppingCartConfirmed)));
console.log('wrapper keeps valibot API (has pipe/type):', 'pipe' in standard, 'type' in standard, Object.keys(standard));
console.log('v.date() JSON Schema:', JSON.stringify(jsonSchemaOf(toStandardJsonSchema(v.object({ at: v.date() })))));
console.log('v.bigint() JSON Schema:', JSON.stringify(jsonSchemaOf(toStandardJsonSchema(v.object({ position: v.bigint() })))));
console.log(
  'toJsonSchema default target (no options):',
  JSON.stringify(toJsonSchema(v.object({ a: v.string() }))),
);
