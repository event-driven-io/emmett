import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { getInMemoryDatabase } from '../../../database/inMemoryDatabase';
import { projections } from '../../../projections';
import type { Event } from '../../../typing';
import { getInMemoryEventStore } from '../../inMemoryEventStore';
import { inMemoryMultiStreamProjection, inMemorySingleStreamProjection } from './inMemoryProjection';

// Sample event types for testing - using Emmett event structure
interface ProductItemAdded {
  type: 'ProductItemAdded';
  data: {
    productId: string;
  };
  metadata: {
    streamName: string;
  };
}

interface DiscountApplied {
  type: 'DiscountApplied';
  data: {
    discount: number;
  };
  metadata: {
    streamName: string;
  };
}

// Union type of all cart events
type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

// Sample document type for projection
type ShoppingCartInfo = {
  _id?: string;
  _version?: bigint;
  cartId: string;
  totalItems: number;
  discount?: number;
};

void describe('InMemory projections', () => {
  void it('should create and update a document with single stream projection', async () => {
    // Define a projection
    const shoppingCartProjection = inMemorySingleStreamProjection<ShoppingCartInfo, ShoppingCartEvent>({
      canHandle: ['ProductItemAdded', 'DiscountApplied'],
      collectionName: 'shoppingCarts',
      initialState: () => ({
        cartId: '',
        totalItems: 0
      }),
      evolve: (document, { type, data: event, metadata }) => {
        switch (type) {
          case 'ProductItemAdded':
            return {
              ...(document || { totalItems: 0 }),
              cartId: metadata.streamName,
              totalItems: (document?.totalItems || 0) + 1
            };
          case 'DiscountApplied':
            return {
              ...(document || { cartId: '', totalItems: 0 }),
              discount: event.discount
            };
          default:
            return document;
        }
      }
    });

    // Get a shared database instance
    const database = getInMemoryDatabase();
    
    // Create event store with the projection
    const eventStore = getInMemoryEventStore({
      projections: projections.inline([shoppingCartProjection])
    });
    
    // Explicitly pass the database to projections through the context
    (eventStore as any).database = database;

    // Create some test events
    const cartId = 'cart-123';
    const events: ShoppingCartEvent[] = [
      {
        type: 'ProductItemAdded',
        data: {
          productId: 'product-1'
        },
        metadata: {
          streamName: cartId
        }
      },
      {
        type: 'DiscountApplied',
        data: {
          discount: 10
        },
        metadata: {
          streamName: cartId
        }
      }
    ];

    // Append events to the stream
    await eventStore.appendToStream(cartId, events);

    // Use the same database instance to check results
    const collection = database.collection<ShoppingCartInfo>('shoppingCarts');
    const document = collection.findOne((doc) => doc.cartId === cartId);

    ok(document, 'Document should exist');
    strictEqual(document!.cartId, cartId);
    strictEqual(document!.totalItems, 1);
    strictEqual(document!.discount, 10);
  });

  void it('should create and update a document with multi-stream projection', async () => {
    // Define a multi-stream projection
    const allCartsProjection = inMemoryMultiStreamProjection<ShoppingCartInfo, ShoppingCartEvent>({
      canHandle: ['ProductItemAdded', 'DiscountApplied'],
      collectionName: 'allCarts',
      getDocumentId: (event) => `cart-summary-${event.metadata.streamName}`,
      initialState: () => ({
        cartId: '',
        totalItems: 0
      }),
      evolve: (document, { type, data: event, metadata }) => {
        switch (type) {
          case 'ProductItemAdded':
            return {
              ...(document || { totalItems: 0 }),
              cartId: metadata.streamName,
              totalItems: (document?.totalItems || 0) + 1
            };
          case 'DiscountApplied':
            return {
              ...(document || { cartId: '', totalItems: 0 }),
              discount: event.discount
            };
          default:
            return document;
        }
      }
    });

    // Get a shared database instance
    const database = getInMemoryDatabase();
    
    // Create event store with the projection
    const eventStore = getInMemoryEventStore({
      projections: projections.inline([allCartsProjection])
    });
    
    // Explicitly pass the database to projections through the context
    (eventStore as any).database = database;

    // Create some test events
    const cartId = 'cart-456';
    const events: ShoppingCartEvent[] = [
      {
        type: 'ProductItemAdded',
        data: {
          productId: 'product-1'
        },
        metadata: {
          streamName: cartId
        }
      },
      {
        type: 'DiscountApplied',
        data: {
          discount: 15
        },
        metadata: {
          streamName: cartId
        }
      }
    ];

    // Append events to the stream
    await eventStore.appendToStream(cartId, events);

    // Use the same database instance to check results
    const collection = database.collection<ShoppingCartInfo>('allCarts');
    const document = collection.findOne((doc) => doc.cartId === cartId);

    ok(document, 'Document should exist');
    strictEqual(document!.cartId, cartId);
    strictEqual(document!.totalItems, 1);
    strictEqual(document!.discount, 15);
  });
});
