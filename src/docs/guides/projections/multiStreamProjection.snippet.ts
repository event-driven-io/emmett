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

interface ClientShoppingSummary {
  _id: string;
  clientId: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: Date | null;
}

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
