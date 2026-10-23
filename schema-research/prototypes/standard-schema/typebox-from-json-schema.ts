// Can TypeBox use a plain JSON Schema object, with no TypeBox code producing it? Research check for qa.md Q24.
import Type, { type Static } from 'typebox';
import Value from 'typebox/value';
import Compile from 'typebox/compile';

// What an Emmett definition's toJSONSchema() could return
const data = {
  type: 'object',
  properties: {
    shoppingCartId: { type: 'string' },
    confirmedAt: { type: 'string', format: 'date-time' },
  },
  required: ['shoppingCartId', 'confirmedAt'],
} as const;

console.log('Value.Check valid  ', Value.Check(data, { shoppingCartId: 'c-1', confirmedAt: '2026-10-23T10:00:00.000Z' }));
console.log('Value.Check invalid', Value.Check(data, { shoppingCartId: 1 }));
console.log('Value.Errors       ', JSON.stringify([...Value.Errors(data, { shoppingCartId: 1 })].map((e) => e.message)));
console.log('Compile().Check    ', Compile(data).Check({ shoppingCartId: 'c-1', confirmedAt: '2026-10-23T10:00:00.000Z' }));

type Data = Static<typeof data>;
const typed: Data = { shoppingCartId: 'c-1', confirmedAt: '2026-10-23T10:00:00.000Z' };
// @ts-expect-error shoppingCartId must be a string
const wrong: Data = { shoppingCartId: 1, confirmedAt: 'x' };
console.log('Static<typeof data> typed:', JSON.stringify(typed), wrong !== undefined);

// Using it inside a TypeBox schema
const event = Type.Object({ type: Type.Literal('ShoppingCartConfirmed'), data: data as never });
console.log('nested in Type.Object', Value.Check(event, { type: 'ShoppingCartConfirmed', data: { shoppingCartId: 'c-1', confirmedAt: 'x' } }));
