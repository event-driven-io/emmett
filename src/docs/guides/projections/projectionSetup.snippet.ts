import type { Event } from '@event-driven-io/emmett';
const connectionString = 'postgresql://user:password@localhost:5432/mydb';

type ProductItemAddedToShoppingCart = Event<
  'ProductItemAddedToShoppingCart',
  {
    shoppingCartId: string;
    quantity: number;
    addedAt: Date;
  }
>;

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
type ShoppingCartEvent = ProductItemAddedToShoppingCart | ShoppingCartConfirmed;

type ShoppingCartSummary = {
  _id: string;
  status: 'Confirmed';
};

const cartSummaryProjection = pongoSingleStreamProjection({
  collectionName: 'shopping_cart_summaries',
  canHandle: ['ProductItemAddedToShoppingCart', 'ShoppingCartConfirmed'],
  evolve: (document: ShoppingCartSummary | null, event: ShoppingCartEvent) => {
    const current = document ?? {
      _id: event.data.shoppingCartId,
      status: 'Confirmed',
    };

    switch (event.type) {
      case 'ProductItemAddedToShoppingCart':
        return current;
      case 'ShoppingCartConfirmed':
        return { ...current, status: 'Confirmed' as const };
    }
  },
});

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

// #region inline-projection-setup
import { projections } from '@event-driven-io/emmett';
import {
  getPostgreSQLEventStore,
  pongoMultiStreamProjection,
  pongoSingleStreamProjection,
} from '@event-driven-io/emmett-postgresql';

const eventStore = getPostgreSQLEventStore(connectionString, {
  // register inline projection
  projections: projections.inline([cartSummaryProjection]),
});
// #endregion inline-projection-setup

// #region async-projection-setup
// create event store events consumer
const consumer = eventStore.consumer();

// register async projection
consumer.projector({ projection: clientSummaryProjection });

// start consuming events and projecting
await consumer.start();
// #endregion async-projection-setup
