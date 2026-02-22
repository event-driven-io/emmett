---
documentationType: reference
outline: deep
---

# SQLite Event Store

SQLite adapter for Emmett providing lightweight, file-based or in-memory event storage perfect for development, testing, and embedded applications.

## Overview

The SQLite event store is ideal for:

- **Local development** - Zero configuration, instant startup
- **Testing** - Fast, isolated, reproducible
- **Embedded applications** - Desktop apps, edge computing
- **Prototyping** - Quick iteration before choosing production database

It provides:

- **File or in-memory storage** - Flexible persistence options
- **Full ACID transactions** - Same guarantees as production databases
- **Inline projections** - Consistent read model updates
- **Background consumers** - Async processing with checkpointing

## Installation

```bash
npm install @event-driven-io/emmett-sqlite
```

### Peer Dependencies

```bash
npm install @event-driven-io/emmett better-sqlite3
npm install -D @types/better-sqlite3
```

## Quick Start

### File-Based Storage

```typescript
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';

const eventStore = getSQLiteEventStore('./events.db');

// Schema auto-creates on first use
```

### In-Memory Storage

```typescript
const eventStore = getSQLiteEventStore(':memory:');
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

## Inline Projections

```typescript
import { sqliteSingleStreamProjection } from '@event-driven-io/emmett-sqlite';

interface CartSummary {
  id: string;
  totalItems: number;
  totalAmount: number;
}

const cartSummaryProjection = sqliteSingleStreamProjection<
  CartSummary,
  ShoppingCartEvent
>({
  tableName: 'cart_summaries',
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

const eventStore = getSQLiteEventStore('./events.db', {
  projections: [cartSummaryProjection],
});
```

## Background Consumers

Process events asynchronously:

```typescript
const consumer = eventStore.consumer();

consumer.projector({
  processorId: 'analytics',
  projection: {
    name: 'Analytics',
    canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
    handle: async (events, context) => {
      for (const event of events) {
        await updateAnalytics(event);
      }
    },
  },
});

await consumer.start();

// Polling configuration
const consumer = eventStore.consumer({
  pollingIntervalMs: 100, // How often to check for new events
  batchSize: 100, // Max events per batch
});
```

## Shared In-Memory Database

For tests that need to share state:

```typescript
import Database from 'better-sqlite3';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';

// Create shared database
const db = new Database(':memory:');

// Multiple stores using same database
const eventStore1 = getSQLiteEventStore({ database: db });
const eventStore2 = getSQLiteEventStore({ database: db });

// Both see the same events
```

## Before-Commit Hooks

Run logic before transaction commits:

```typescript
const eventStore = getSQLiteEventStore('./events.db', {
  beforeCommit: async (events, context) => {
    // Validate, enrich, or reject events
    for (const event of events) {
      if (event.type === 'ProductItemAdded' && event.data.quantity > 100) {
        throw new Error('Quantity too large');
      }
    }
  },
});
```

## Manual Schema Management

For advanced control:

```typescript
const eventStore = getSQLiteEventStore('./events.db', {
  schema: {
    autoMigration: 'None', // Don't auto-create tables
  },
});

// Get schema SQL
const sql = eventStore.schema.sql();
console.log(sql);

// Manually migrate
await eventStore.schema.migrate();
```

## Database Schema

SQLite event store creates three tables:

| Table               | Purpose                      |
| ------------------- | ---------------------------- |
| `emt_streams`       | Stream metadata and versions |
| `emt_messages`      | Event storage (JSON)         |
| `emt_subscriptions` | Consumer checkpoints         |

## Configuration Options

```typescript
const eventStore = getSQLiteEventStore(pathOrDb, {
  // Inline projections
  projections: [projection1, projection2],

  // Schema management
  schema: {
    autoMigration: 'CreateOrUpdate', // or 'None'
  },

  // Before-commit hook
  beforeCommit: async (events, context) => {
    /* ... */
  },
});
```

## Testing Best Practices

### Isolated Test Databases

```typescript
import { v4 as uuid } from 'uuid';

describe('Shopping Cart', () => {
  let eventStore: SQLiteEventStore;

  beforeEach(() => {
    // Each test gets fresh in-memory database
    eventStore = getSQLiteEventStore(':memory:');
  });

  it('adds products', async () => {
    await eventStore.appendToStream('cart-1', [
      {
        type: 'ProductItemAdded',
        data: { productId: 'p1', quantity: 1, price: 10 },
      },
    ]);

    const { events } = await eventStore.readStream('cart-1');
    expect(events).toHaveLength(1);
  });
});
```

### Testing Projections

```typescript
import { SQLiteProjectionSpec } from '@event-driven-io/emmett-sqlite';

describe('Cart Summary Projection', () => {
  let given: SQLiteProjectionSpec<ShoppingCartEvent>;

  beforeEach(() => {
    given = SQLiteProjectionSpec.for({
      projection: cartSummaryProjection,
      database: ':memory:',
    });
  });

  it('creates summary', () =>
    given([])
      .when([
        {
          type: 'ProductItemAdded',
          data: { productId: 'shoes', quantity: 2, price: 100 },
          metadata: { streamName: 'cart-123' },
        },
      ])
      .then(
        expectRow('cart_summaries', 'cart-123').toEqual({
          totalItems: 2,
          totalAmount: 200,
        }),
      ));
});
```

## Limitations

SQLite is excellent for development but has production limitations:

| Aspect          | Limitation                   |
| --------------- | ---------------------------- |
| **Concurrency** | Single writer at a time      |
| **Scaling**     | No horizontal scaling        |
| **Networking**  | File-based, no remote access |
| **Size**        | Practical limit ~1TB         |

**For production, consider:**

- [PostgreSQL](/event-stores/postgresql) - Most applications
- [EventStoreDB](/event-stores/esdb) - Native Event Sourcing
- [MongoDB](/event-stores/mongodb) - Document-centric

## Full Package Documentation

For complete API reference and advanced usage, see the [package README](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-sqlite).

## See Also

- [Choosing an Event Store](/guides/choosing-event-store)
- [Testing Patterns](/guides/testing)
- [Projections Guide](/guides/projections)
