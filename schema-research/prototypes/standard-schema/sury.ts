import * as S from 'sury';
import { inspect, jsonSchemaOf } from './harness.ts';

S.enableStandardJSONSchema();

const ShoppingCartConfirmed = S.schema({
  cartId: S.uuid.with(S.meta, { description: 'Cart id', examples: ['6f1c2a8e-0b7a-4d43-9a57-1d2c7c6c1f10'] }),
  confirmedAt: S.isoDateTime.with(S.to, S.date),
  totalAmount: S.number,
  itemsCount: S.int32,
  status: S.union(['Confirmed', 'Cancelled']),
  note: S.optional(S.string.with(S.meta, { deprecated: true })),
  discountCode: S.nullable(S.string),
  items: S.array(S.schema({ productId: S.string, quantity: S.int32 })),
  tags: S.record(S.string),
}).with(S.meta, { title: 'Shopping cart confirmed', description: 'Shopper confirmed the cart' });

await inspect('sury', ShoppingCartConfirmed);
console.log('bigint input JSON Schema:', JSON.stringify(jsonSchemaOf(S.schema({ position: S.bigint }))));
console.log('bigint via S.json wrapper:', JSON.stringify(jsonSchemaOf(S.json.with(S.to, S.schema({ position: S.bigint })))));
