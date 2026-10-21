import Type, { type Static, type StaticDecode, type StaticEncode } from 'typebox';
import { Compile } from 'typebox/compile';
import Value from 'typebox/value';
import { inspect } from './harness.ts';

const ConfirmedAt = Type.Codec(Type.String({ format: 'date-time' }))
  .Decode((value) => new Date(value))
  .Encode((value) => value.toISOString());

const ShoppingCartConfirmed = Type.Object(
  {
    cartId: Type.String({ format: 'uuid', description: 'Cart id', examples: ['6f1c2a8e-0b7a-4d43-9a57-1d2c7c6c1f10'] }),
    confirmedAt: ConfirmedAt,
    totalAmount: Type.Number({ minimum: 0 }),
    itemsCount: Type.Integer(),
    status: Type.Union([Type.Literal('Confirmed'), Type.Literal('Cancelled')]),
    note: Type.Optional(Type.String({ deprecated: true })),
    discountCode: Type.Union([Type.String(), Type.Null()]),
    items: Type.Array(Type.Object({ productId: Type.String(), quantity: Type.Integer({ minimum: 1 }) })),
    tags: Type.Record(Type.String(), Type.String()),
  },
  { $id: 'ShoppingCartConfirmed', title: 'Shopping cart confirmed', description: 'Shopper confirmed the cart', 'x-emmett-kind': 'Event' },
);

type Decoded = StaticDecode<typeof ShoppingCartConfirmed>;
type Encoded = StaticEncode<typeof ShoppingCartConfirmed>;
type Plain = Static<typeof ShoppingCartConfirmed>;
const d: Decoded['confirmedAt'] = new Date();
const e: Encoded['confirmedAt'] = '2026-10-04T10:00:00.000Z';
void d;
void e;
const p: Plain['confirmedAt'] = '' as Plain['confirmedAt'];
void p;

console.log('JSON.stringify(schema):', JSON.stringify(ShoppingCartConfirmed));
console.log('own keys incl. symbols/non-enumerable:', Reflect.ownKeys(ShoppingCartConfirmed));
console.log('confirmedAt own keys:', Reflect.ownKeys(ShoppingCartConfirmed.properties.confirmedAt));

const validator = Compile(ShoppingCartConfirmed);
console.log('Compile result has ~standard:', '~standard' in (validator as object));
await inspect('typebox Compile() validator', validator);
await inspect('typebox raw schema', ShoppingCartConfirmed);

const wire = {
  cartId: '6f1c2a8e-0b7a-4d43-9a57-1d2c7c6c1f10',
  confirmedAt: '2026-10-04T10:00:00.000Z',
  totalAmount: 1,
  itemsCount: 1,
  status: 'Confirmed',
  discountCode: null,
  items: [],
  tags: {},
};
console.log('Value.Check(wire):', Value.Check(ShoppingCartConfirmed, wire));
console.log('Value.Decode(wire).confirmedAt instanceof Date:', Value.Decode(ShoppingCartConfirmed, wire).confirmedAt instanceof Date);
console.log('Type.BigInt():', JSON.stringify(Type.BigInt()));
console.log('Type.Script:', JSON.stringify(Type.Script('{ cartId: string, itemsCount: number }')));
