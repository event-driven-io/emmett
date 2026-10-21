import { type } from 'arktype';
import { inspect, jsonSchemaOf } from './harness.ts';

const ShoppingCartConfirmed = type({
  cartId: type('string.uuid').configure({ description: 'Cart id', examples: ['6f1c2a8e-0b7a-4d43-9a57-1d2c7c6c1f10'] }),
  confirmedAt: 'string.date.iso.parse',
  totalAmount: 'number >= 0',
  itemsCount: 'number.integer',
  status: "'Confirmed' | 'Cancelled'",
  'note?': type('string').configure({ deprecated: true }),
  discountCode: 'string | null',
  items: type({ productId: 'string', quantity: 'number.integer > 0' }).array(),
  tags: 'Record<string, string>',
}).configure({
  title: 'Shopping cart confirmed',
  description: 'Shopper confirmed the cart',
  'x-emmett-kind': 'Event',
} as never);

await inspect('arktype', ShoppingCartConfirmed);

console.log('meta read back:', JSON.stringify(ShoppingCartConfirmed.meta));
console.log('Date JSON Schema:', JSON.stringify(jsonSchemaOf(type({ at: 'Date' }))));
console.log('bigint JSON Schema:', JSON.stringify(jsonSchemaOf(type({ position: 'bigint' }))));
console.log(
  'Date JSON Schema with fallback via libraryOptions:',
  JSON.stringify(
    (type({ at: 'Date' }) as never as { '~standard': { jsonSchema: { input: (o: unknown) => unknown } } })['~standard'].jsonSchema.input({
      target: 'draft-2020-12',
      libraryOptions: { fallback: { date: (ctx: { base: object }) => ({ ...ctx.base, type: 'string', format: 'date-time' }) } },
    }),
  ),
);
