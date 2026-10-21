import { Schema } from 'effect';
import { inspect, jsonSchemaOf } from './harness.ts';

const ShoppingCartConfirmed = Schema.Struct({
  cartId: Schema.String.annotate({ description: 'Cart id', examples: ['6f1c2a8e-0b7a-4d43-9a57-1d2c7c6c1f10'] }),
  confirmedAt: Schema.Date,
  totalAmount: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  itemsCount: Schema.Int,
  status: Schema.Literals(['Confirmed', 'Cancelled']),
  note: Schema.optionalKey(Schema.String.annotate({ deprecated: true } as never)),
  discountCode: Schema.NullOr(Schema.String),
  items: Schema.Array(Schema.Struct({ productId: Schema.String, quantity: Schema.Int })),
  tags: Schema.Record(Schema.String, Schema.String),
}).annotate({
  identifier: 'ShoppingCartConfirmed',
  title: 'Shopping cart confirmed',
  description: 'Shopper confirmed the cart',
});

await inspect('effect Schema (no adapter)', ShoppingCartConfirmed);

const json = Schema.toCodecJson(ShoppingCartConfirmed);
const standard = Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(json));
await inspect('effect toStandardSchemaV1(toCodecJson(schema)) + toStandardJSONSchemaV1', standard);

const direct = Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(ShoppingCartConfirmed));
await inspect('effect toStandardSchemaV1(schema) (no JSON codec) - Date expected as Date instance', direct);

console.log('adapter mutates and returns same object:', direct === (ShoppingCartConfirmed as unknown));
console.log('BigInt JSON Schema (input):', JSON.stringify(jsonSchemaOf(Schema.toStandardJSONSchemaV1(Schema.Struct({ position: Schema.BigInt })))));
console.log('toJsonSchemaDocument:', JSON.stringify(Schema.toJsonSchemaDocument(Schema.Struct({ at: Schema.Date, position: Schema.BigInt }))));
console.log('encode Date to JSON wire:', JSON.stringify(Schema.encodeUnknownSync(Schema.toCodecJson(Schema.Struct({ at: Schema.Date, position: Schema.BigInt })))({ at: new Date('2026-10-04T10:00:00.000Z'), position: 10n })));
