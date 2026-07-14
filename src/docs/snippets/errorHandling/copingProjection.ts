/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Event } from '@event-driven-io/emmett';
import { pongoSingleStreamProjection } from '@event-driven-io/emmett-postgresql';

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: { unitPrice: number; quantity: number } }
>;

type DiscountApplied = Event<'DiscountApplied', { amount: number }>;

type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

type CartSummary = { totalAmount: number };

// #region coping-projection
const cartSummaryProjection = pongoSingleStreamProjection({
  collectionName: 'cart_summaries',
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
  evolve: (
    document: CartSummary,
    { type, data: event }: ShoppingCartEvent,
  ): CartSummary => {
    switch (type) {
      case 'ProductItemAdded':
        return {
          totalAmount:
            document.totalAmount +
            event.productItem.unitPrice * event.productItem.quantity,
        };
      case 'DiscountApplied':
        // the discount is already recorded: don't throw if the total drifts
        // below zero, clamp it and keep the read model sane
        return {
          totalAmount: Math.max(document.totalAmount - event.amount, 0),
        };
    }
  },
  initialState: () => ({ totalAmount: 0 }),
});
// #endregion coping-projection
