---
documentationType: reference
outline: deep
---

# MongoDB Event Store

MongoDB adapter for Emmett providing document-oriented event storage with flexible schemas and inline projections.

## Overview

The MongoDB event store is ideal for teams already using MongoDB. It provides:

- **Document-oriented storage** - Natural fit for event data
- **Flexible schemas** - Easy to evolve event structures
- **Storage strategies** - Multiple approaches for different needs
- **Inline projections** - Update read models in the same operation
- **Familiar querying** - Standard MongoDB query patterns

## Installation

```bash
npm install @event-driven-io/emmett-mongodb
```

### Peer Dependencies

```bash
npm install @event-driven-io/emmett mongodb
```

## Quick Start

### Basic Setup

```typescript
import { getMongoDBEventStore } from '@event-driven-io/emmett-mongodb';

const eventStore = getMongoDBEventStore({
  connectionString: 'mongodb://localhost:27017',
  database: 'events',
});
```

### Using Existing MongoClient

```typescript
import { MongoClient } from 'mongodb';
import { getMongoDBEventStore } from '@event-driven-io/emmett-mongodb';

const client = new MongoClient('mongodb://localhost:27017');
await client.connect();

const eventStore = getMongoDBEventStore({
  client,
  database: 'events',
});
```

### Appending Events

```typescript
import { type Event } from '@event-driven-io/emmett';

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productId: string; quantity: number; price: number }
>;

const result = await eventStore.appendToStream<ProductItemAdded>(
  'ShoppingCart-123',
  [
    {
      type: 'ProductItemAdded',
      data: { productId: 'shoes-1', quantity: 2, price: 99.99 },
    },
  ],
);
```

### Reading Events

```typescript
const { events, currentStreamVersion } =
  await eventStore.readStream('ShoppingCart-123');

for (const event of events) {
  console.log(event.type, event.data);
}
```

### Aggregating State

```typescript
const { state } = await eventStore.aggregateStream('ShoppingCart-123', {
  evolve: (state, event) => {
    switch (event.type) {
      case 'ProductItemAdded':
        return { ...state, items: [...state.items, event.data] };
      default:
        return state;
    }
  },
  initialState: () => ({ items: [] }),
});
```

## Storage Strategies

MongoDB offers three storage strategies:

### 1. Single Collection (Default)

All events in one collection with stream ID as a field:

```typescript
const eventStore = getMongoDBEventStore({
  connectionString,
  database: 'events',
  storage: { type: 'single-collection', collectionName: 'events' },
});
```

### 2. Collection Per Stream Type

Separate collections for each stream category:

```typescript
const eventStore = getMongoDBEventStore({
  connectionString,
  database: 'events',
  storage: { type: 'collection-per-stream-type' },
});

// Creates: ShoppingCart, Order, User collections
```

### 3. Document Per Stream

Each stream is a single document with embedded events:

```typescript
const eventStore = getMongoDBEventStore({
  connectionString,
  database: 'events',
  storage: { type: 'document-per-stream' },
});
```

**Choose based on:**

- Single collection: Simple, works for most cases
- Per stream type: Better querying by entity type
- Document per stream: Optimal for small streams, atomic reads

## Inline Projections

Update read models when events are appended:

```typescript
import { mongoDBInlineProjection } from '@event-driven-io/emmett-mongodb';

interface CartSummary {
  _id: string;
  totalItems: number;
  totalAmount: number;
}

const cartSummaryProjection = mongoDBInlineProjection<
  CartSummary,
  ShoppingCartEvent
>({
  collectionName: 'cart_summaries',
  canHandle: ['ProductItemAdded', 'ProductItemRemoved'],
  evolve: (document, event) => {
    const current = document ?? { totalItems: 0, totalAmount: 0 };

    switch (event.type) {
      case 'ProductItemAdded':
        return {
          ...current,
          totalItems: current.totalItems + event.data.quantity,
          totalAmount:
            current.totalAmount + event.data.price * event.data.quantity,
        };
      case 'ProductItemRemoved':
        return {
          ...current,
          totalItems: current.totalItems - event.data.quantity,
          totalAmount:
            current.totalAmount - event.data.price * event.data.quantity,
        };
    }
  },
});

const eventStore = getMongoDBEventStore({
  connectionString,
  database: 'events',
  projections: [cartSummaryProjection],
});
```

## Querying Projections

```typescript
const db = client.db('events');
const cartSummaries = db.collection<CartSummary>('cart_summaries');

// Find by ID
const cart = await cartSummaries.findOne({ _id: 'cart-123' });

// Query with filters
const largeCarts = await cartSummaries
  .find({ totalAmount: { $gte: 1000 } })
  .sort({ totalAmount: -1 })
  .limit(10)
  .toArray();
```

## Accessing Raw Collections

For advanced queries:

```typescript
const eventStore = getMongoDBEventStore({
  connectionString,
  database: 'events',
});

// Access the underlying MongoDB client
const db = eventStore.database;
const eventsCollection = db.collection('events');

// Custom queries
const recentEvents = await eventsCollection
  .find({ 'metadata.timestamp': { $gte: new Date(Date.now() - 3600000) } })
  .toArray();
```

## Testing

### BDD-Style Testing

```typescript
import { MongoDBProjectionSpec } from '@event-driven-io/emmett-mongodb';

describe('Cart Summary Projection', () => {
  let given: MongoDBProjectionSpec<ShoppingCartEvent>;

  beforeAll(async () => {
    const container = await new MongoDBContainer().start();

    given = MongoDBProjectionSpec.for({
      projection: cartSummaryProjection,
      connectionString: container.getConnectionString(),
    });
  });

  it('creates summary from first event', () =>
    given([])
      .when([
        {
          type: 'ProductItemAdded',
          data: { productId: 'shoes', quantity: 2, price: 100 },
          metadata: { streamName: 'cart-123' },
        },
      ])
      .then(
        expectDocuments
          .fromCollection('cart_summaries')
          .withId('cart-123')
          .toBeEqual({ totalItems: 2, totalAmount: 200 }),
      ));
});
```

## Document Structure

Events are stored as:

```json
{
  "_id": "unique-event-id",
  "streamId": "ShoppingCart-123",
  "streamPosition": 0,
  "globalPosition": 42,
  "type": "ProductItemAdded",
  "data": {
    "productId": "shoes-1",
    "quantity": 2,
    "price": 99.99
  },
  "metadata": {
    "timestamp": "2024-01-15T10:30:00Z",
    "correlationId": "request-789"
  }
}
```

## Configuration Options

```typescript
const eventStore = getMongoDBEventStore({
  // Connection
  connectionString: 'mongodb://localhost:27017',
  // or: client: existingMongoClient,

  // Database name
  database: 'events',

  // Storage strategy
  storage: {
    type: 'single-collection', // or 'collection-per-stream-type' or 'document-per-stream'
    collectionName: 'events',
  },

  // Inline projections
  projections: [projection1, projection2],
});
```

## Full Package Documentation

For complete API reference and advanced usage, see the [package README](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-mongodb).

## See Also

- [Choosing an Event Store](/guides/choosing-event-store)
- [Projections Guide](/guides/projections)
- [How to build MongoDB Event Store](https://event-driven.io/en/how_to_build_mongodb_event_store/)
