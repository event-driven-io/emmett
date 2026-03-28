/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Event } from '@event-driven-io/emmett';

type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  {
    shoppingCartId: string;
    totalAmount: number;
    confirmedAt: Date;
  },
  {
    clientId: string;
  }
>;
// #region multi-stream-projection
import { pongoMultiStreamProjection } from '@event-driven-io/emmett-postgresql';

type ClientShoppingSummary = {
  _id: string;
  clientId: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: Date | null;
};

const clientSummaryProjection = pongoMultiStreamProjection({
  collectionName: 'client_summaries',
  canHandle: ['ShoppingCartConfirmed'],
  // Extract document ID from event metadata
  getDocumentId: (event) => event.metadata.clientId,
  evolve: (
    document: ClientShoppingSummary | null,
    event: ShoppingCartConfirmed,
  ) => {
    const current = document ?? {
      _id: event.metadata.clientId,
      clientId: event.metadata.clientId,
      totalOrders: 0,
      totalSpent: 0,
      lastOrderDate: null,
    };

    return {
      ...current,
      totalOrders: current.totalOrders + 1,
      totalSpent: current.totalSpent + event.data.totalAmount,
      lastOrderDate: event.data.confirmedAt,
    };
  },
});
// #endregion multi-stream-projection

// #region projection-with-default
const projectionWithDefault = pongoMultiStreamProjection({
  collectionName: 'client_summaries',
  canHandle: ['ShoppingCartConfirmed'],
  getDocumentId: (event) => event.metadata.clientId,
  // Provide initial state for the document,
  // so document is never null in evolve function
  initialState: () => ({
    _id: 'unknown',
    clientId: 'unknown',
    totalOrders: 0,
    totalSpent: 0,
    lastOrderDate: new Date(0),
  }),
  // Look Ma, no nulls! Initial state is used when document doesn't exist,
  // so document is never null in evolve function
  evolve: (document: ClientShoppingSummary, event: ShoppingCartConfirmed) => {
    return {
      ...document,
      _id: event.metadata.clientId,
      clientId: event.metadata.clientId,
      totalOrders: document.totalOrders + 1,
      totalSpent: document.totalSpent + event.data.totalAmount,
      lastOrderDate: event.data.confirmedAt,
    };
  },
});
// #endregion projection-with-default
