// Can `.Type` and an `InferEvent<typeof X>` helper both give the same type?
import type { Event as EmmettEvent } from '@event-driven-io/emmett';
import { Event, s } from '../lib';

type InferEvent<D extends { readonly Type: EmmettEvent }> = D['Type'];

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
});

type ViaProperty = typeof ShoppingCartConfirmed.Type;
type ViaHelper = InferEvent<typeof ShoppingCartConfirmed>;

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assert = <T extends true>() => {};

assert<Equals<ViaProperty, ViaHelper>>();
assert<
  Equals<
    ViaHelper,
    EmmettEvent<'ShoppingCartConfirmed', { shoppingCartId: string; confirmedAt: Date }>
  >
>();
