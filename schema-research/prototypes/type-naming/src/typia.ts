import typia from 'typia';

type Event<T extends string, D, M = undefined> = Readonly<{ type: T; data: D; metadata?: M }>;

export type ShoppingCartEventMetadata = { clientId: string };

export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { shoppingCartId: string; confirmedAt: Date },
  ShoppingCartEventMetadata
>;
export type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  { shoppingCartId: string; cancelledAt: Date },
  ShoppingCartEventMetadata
>;
export type ShoppingCartEvent = ShoppingCartConfirmed | ShoppingCartCancelled;

const validate = typia.createValidate<ShoppingCartEvent>();

console.log('valid:', JSON.stringify(validate({ type: 'ShoppingCartConfirmed', data: { shoppingCartId: '1', confirmedAt: new Date() } }).success));
console.log('invalid:', JSON.stringify(validate({ type: 'ShoppingCartConfirmed', data: { shoppingCartId: 1 } })));
console.log('schema:', JSON.stringify(typia.json.schema<ShoppingCartEvent>(), null, 1));
console.log('standard:', typeof (validate as unknown as Record<string, unknown>)['~standard']);
console.log('standard keys:', Object.keys((validate as unknown as Record<string, Record<string, unknown>>)['~standard']));
