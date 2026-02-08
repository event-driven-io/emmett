---
documentationType: reference
outline: deep
---

# PostgreSQL Event Store

PostgreSQL adapter for Emmett providing persistent event storage with partitioned tables, inline projections, and async message consumers.

## Overview

The PostgreSQL event store is the recommended choice for most production applications. It provides:

- **Persistent storage** with ACID transactions
- **Inline projections** executing in the same transaction as event appends
- **Async consumers** with batch processing and checkpointing
- **Pongo integration** for document-style projections using PostgreSQL JSONB
- **Multi-tenancy** via table partitioning
- **CLI migrations** for schema management

## Installation

```bash
npm install @event-driven-io/emmett-postgresql
```

### Peer Dependencies

```bash
npm install @event-driven-io/emmett @event-driven-io/pongo
```

## Quick Start

### Basic Setup

```typescript
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

const eventStore = getPostgreSQLEventStore(
  'postgresql://user:password@localhost:5432/mydb',
);

// Schema auto-migrates by default
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

console.log(result.nextExpectedStreamVersion); // 1n
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
        return {
          ...state,
          items: [...state.items, event.data],
        };
      default:
        return state;
    }
  },
  initialState: () => ({ items: [], status: 'Open' }),
});
```

## Inline Projections

Inline projections run within the same transaction as event appends, ensuring consistency.

### Single-Stream Projection

```typescript
import { pongoSingleStreamProjection } from '@event-driven-io/emmett-postgresql';

interface CartSummary {
  _id: string;
  totalItems: number;
  totalAmount: number;
}

const cartSummaryProjection = pongoSingleStreamProjection<
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

const eventStore = getPostgreSQLEventStore(connectionString, {
  projections: projections.inline([cartSummaryProjection]),
});
```

### Multi-Stream Projection

```typescript
import { pongoMultiStreamProjection } from '@event-driven-io/emmett-postgresql';

const clientSummaryProjection = pongoMultiStreamProjection<
  ClientSummary,
  ShoppingCartEvent
>({
  collectionName: 'client_summaries',
  canHandle: ['ShoppingCartConfirmed'],
  getDocumentId: (event) => event.metadata.clientId,
  evolve: (document, event) => ({
    clientId: event.metadata.clientId,
    totalOrders: (document?.totalOrders ?? 0) + 1,
    totalSpent: (document?.totalSpent ?? 0) + event.data.totalAmount,
  }),
});
```

## Async Consumers

For background processing with checkpointing:

```typescript
const consumer = eventStore.consumer();

// Projector for read model updates
consumer.projector({
  processorId: 'cart-analytics',
  projection: {
    name: 'CartAnalytics',
    canHandle: ['ShoppingCartConfirmed'],
    handle: async (events, { execute }) => {
      for (const event of events) {
        await execute.command(/* SQL to update analytics */);
      }
    },
  },
});

// Reactor for side effects
consumer.reactor({
  processorId: 'order-notifications',
  eachMessage: async (message, context) => {
    if (message.type === 'ShoppingCartConfirmed') {
      await sendOrderConfirmationEmail(message.metadata.clientId);
    }
  },
  canHandle: ['ShoppingCartConfirmed'],
});

await consumer.start();
```

## Transactions

Use sessions for multi-stream transactions:

```typescript
await eventStore.withSession(async ({ eventStore: session }) => {
  await session.appendToStream('Cart-1', [event1]);
  await session.appendToStream('Cart-2', [event2]);
  // Both succeed or both fail
});
```

## CLI Commands

```bash
# Run migrations
npx emmett migrate run --connectionString "postgresql://..."

# Generate migration SQL
npx emmett migrate sql --print
```

## Database Schema

The event store creates three partitioned tables:

| Table               | Purpose                       |
| ------------------- | ----------------------------- |
| `emt_streams`       | Stream metadata and positions |
| `emt_messages`      | Event/message storage (JSONB) |
| `emt_subscriptions` | Consumer checkpoint tracking  |

## Configuration Options

```typescript
const eventStore = getPostgreSQLEventStore(connectionString, {
  // Inline projections
  projections: projections.inline([projection1, projection2]),

  // Schema migration
  schema: {
    autoMigration: 'CreateOrUpdate', // or 'None'
  },

  // Connection pool
  connectionOptions: {
    max: 20,
    idleTimeoutMillis: 30000,
  },
});
```

## Querying Read Models

Use Pongo to query projection data:

```typescript
import { pongoClient } from '@event-driven-io/pongo';

const pongo = pongoClient(connectionString);
const cartSummaries = pongo.db().collection<CartSummary>('cart_summaries');

// Find by ID
const cart = await cartSummaries.findOne({ _id: 'cart-123' });

// Query with filters
const largeCarts = await cartSummaries
  .find({ totalAmount: { $gte: 1000 } })
  .sort({ totalAmount: -1 })
  .limit(10)
  .toArray();
```

## Full Package Documentation

For complete API reference and advanced usage, see the [package README](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-postgresql).

## See Also

- [Choosing an Event Store](/guides/choosing-event-store)
- [Projections Guide](/guides/projections)
- [Testing Patterns](/guides/testing)
- [Getting Started](/getting-started) - Full tutorial with PostgreSQL
