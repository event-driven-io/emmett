import type { Command, Event } from '@event-driven-io/emmett';

export type ProductItem = { productId: string; quantity: number };

export type D1 = { productId: string };
export type D2 = { productItem: ProductItem };
export type Meta = { tenant: string };

export type V1 = Event<'ProductItemAdded', D1>;
export type V2 = Event<'ProductItemAdded', D2, undefined, 2>;
export type V2m = Event<'ProductItemAdded', D2, Meta, 2>;
export type Stored = V1 | V2;

export type C1 = Command<'AddProductItem', D1>;
export type C2 = Command<'AddProductItem', D2, undefined, 2>;
export type C3 = Command<'AddProductItem', D2, undefined, 3>;

export const v1: V1 = { type: 'ProductItemAdded', data: { productId: 'p' } };
export const v2: V2 = {
  type: 'ProductItemAdded',
  data: { productItem: { productId: 'p', quantity: 1 } },
  schemaVersion: 2,
};

export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
export const assertType = <_T extends true>(): void => {};
