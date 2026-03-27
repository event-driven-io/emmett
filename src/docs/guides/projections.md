---
documentationType: how-to-guide
outline: deep
---

# Projections Deep Dive

Projections transform event streams into read models optimized for queries. This guide covers patterns, implementation, and best practices.

## Why Projections?

In Event Sourcing, rebuilding state from events works well for single entities. But queries like "show all shopping carts" would require reading thousands of streams and rebuilding each cart in memory.

**Projections solve this by:**

- Pre-computing query results as events occur
- Storing optimized read models in queryable formats
- Updating incrementally rather than recomputing

## Types of Projections

### Single-Stream Projections

One event stream maps to one document. The document ID equals the stream ID.

**Use when:** Your read model represents a single entity (shopping cart, order, user profile).

```typescript
import { pongoSingleStreamProjection } from '@event-driven-io/emmett-postgresql';

interface ShoppingCartSummary {
  _id: string;
  productItemsCount: number;
  totalAmount: number;
}

const cartSummaryProjection = pongoSingleStreamProjection<
  ShoppingCartSummary,
  ShoppingCartEvent
>({
  collectionName: 'shopping_cart_summaries',
  canHandle: ['ProductItemAdded', 'ProductItemRemoved'],
  evolve: (document, event) => {
    const current = document ?? { productItemsCount: 0, totalAmount: 0 };

    switch (event.type) {
      case 'ProductItemAdded':
        return {
          ...current,
          productItemsCount: current.productItemsCount + event.data.quantity,
          totalAmount:
            current.totalAmount + event.data.price * event.data.quantity,
        };
      case 'ProductItemRemoved':
        return {
          ...current,
          productItemsCount: current.productItemsCount - event.data.quantity,
          totalAmount:
            current.totalAmount - event.data.price * event.data.quantity,
        };
    }
  },
});
```

### Multi-Stream Projections

Events from multiple streams combine into documents with custom IDs.

**Use when:** Your read model aggregates across entities (customer analytics, product statistics, dashboards).

```typescript
import { pongoMultiStreamProjection } from '@event-driven-io/emmett-postgresql';

interface ClientShoppingSummary {
  _id: string;
  clientId: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: Date | null;
}

const clientSummaryProjection = pongoMultiStreamProjection<
  ClientShoppingSummary,
  ShoppingCartEvent
>({
  collectionName: 'client_summaries',
  canHandle: ['ShoppingCartConfirmed'],
  // Extract document ID from event metadata
  getDocumentId: (event) => event.metadata.clientId,
  evolve: (document, event) => {
    const current = document ?? {
      clientId: event.metadata.clientId,
      totalOrders: 0,
      totalSpent: 0,
      lastOrderDate: null,
    };

    if (event.type === 'ShoppingCartConfirmed') {
      return {
        ...current,
        totalOrders: current.totalOrders + 1,
        totalSpent: current.totalSpent + event.data.totalAmount,
        lastOrderDate: event.data.confirmedAt,
      };
    }

    return current;
  },
});
```

## Inline vs Async Projections

### Inline Projections

Execute within the same transaction as the event append.

**Pros:**

- Strong consistency - read model always matches events
- No eventual consistency delays
- Simpler mental model

**Cons:**

- Slower appends (projection runs synchronously)
- Transaction scope limitations
- Can't project to external systems

```typescript
const eventStore = getPostgreSQLEventStore(connectionString, {
  projections: projections.inline([
    cartSummaryProjection,
    clientSummaryProjection,
  ]),
});
```

### Async Projections

Process events in background consumers with checkpointing.

**Pros:**

- Faster appends
- Can project to external systems
- Better scalability

**Cons:**

- Eventual consistency
- Requires checkpoint management
- More infrastructure

```typescript
const consumer = eventStore.consumer();

consumer.projector({
  processorId: 'cart-summary-projector',
  projection: cartSummaryProjection,
});

await consumer.start();
```

## Projection Patterns

### Initial State Pattern

Provide a default state instead of handling null:

```typescript
const projection = pongoSingleStreamProjection({
  collectionName: 'cart_details',
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    items: [],
    status: 'Open',
    totalAmount: 0,
  }),
  evolve: (document, event) => {
    // document is never null
    switch (event.type) {
      case 'ProductItemAdded':
        return {
          ...document,
          items: [...document.items, event.data],
          totalAmount:
            document.totalAmount + event.data.price * event.data.quantity,
        };
      case 'ShoppingCartConfirmed':
        return { ...document, status: 'Confirmed' };
    }
  },
});
```

### Deletion Pattern

Return `null` to delete the document:

```typescript
evolve: (document, event) => {
  switch (event.type) {
    case 'ProductItemAdded':
      return {
        /* updated document */
      };
    case 'ShoppingCartConfirmed':
      // Delete the pending cart document
      return null;
  }
};
```

### Selective Handling

Only handle events relevant to your read model:

```typescript
const projection = pongoSingleStreamProjection({
  collectionName: 'cart_totals',
  // Only care about price-affecting events
  canHandle: ['ProductItemAdded', 'ProductItemRemoved', 'DiscountApplied'],
  evolve: (document, event) => {
    // ShoppingCartConfirmed won't reach here
  },
});
```

### Metadata Usage

Access event metadata for cross-stream correlation:

```typescript
const projection = pongoMultiStreamProjection({
  collectionName: 'daily_sales',
  canHandle: ['ShoppingCartConfirmed'],
  getDocumentId: (event) => {
    const date = event.metadata.timestamp.toISOString().split('T')[0];
    return `sales-${date}`;
  },
  evolve: (document, event) => ({
    date: document?.date ?? event.metadata.timestamp,
    totalSales: (document?.totalSales ?? 0) + event.data.totalAmount,
    orderCount: (document?.orderCount ?? 0) + 1,
  }),
});
```

## Querying Read Models

### With Pongo (PostgreSQL)

```typescript
import { pongoClient } from '@event-driven-io/pongo';

const pongo = pongoClient(connectionString);
const cartSummaries = pongo
  .db()
  .collection<ShoppingCartSummary>('cart_summaries');

// Find by ID
const cart = await cartSummaries.findOne({ _id: 'cart-123' });

// Query with filters
const largeCarts = await cartSummaries
  .find({ totalAmount: { $gte: 1000 } })
  .toArray();

// With sorting and pagination
const recentCarts = await cartSummaries
  .find({})
  .sort({ lastUpdated: -1 })
  .limit(10)
  .toArray();
```

### In API Routes

```typescript
router.get(
  '/carts/:cartId/summary',
  on(async (request) => {
    const cartId = request.params.cartId;
    const summary = await cartSummaries.findOne({ _id: cartId });

    if (!summary) {
      return notFound({ detail: 'Cart not found' });
    }

    return ok(summary);
  }),
);

router.get(
  '/carts',
  on(async (request) => {
    const minAmount = parseFloat(request.query.minAmount ?? '0');

    const carts = await cartSummaries
      .find({ totalAmount: { $gte: minAmount } })
      .toArray();

    return ok({ carts });
  }),
);
```

## Testing Projections

Use the `PostgreSQLProjectionSpec` for BDD-style tests:

```typescript
import {
  PostgreSQLProjectionSpec,
  expectPongoDocuments,
  eventsInStream,
  newEventsInStream,
} from '@event-driven-io/emmett-postgresql';

describe('Cart Summary Projection', () => {
  let given: PostgreSQLProjectionSpec<ShoppingCartEvent>;

  beforeAll(async () => {
    const postgres = await new PostgreSqlContainer().start();

    given = PostgreSQLProjectionSpec.for({
      projection: cartSummaryProjection,
      connectionString: postgres.getConnectionUri(),
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
        expectPongoDocuments
          .fromCollection<ShoppingCartSummary>('cart_summaries')
          .withId('cart-123')
          .toBeEqual({
            productItemsCount: 2,
            totalAmount: 200,
          }),
      ));

  it('accumulates across events', () =>
    given(
      eventsInStream('cart-123', [
        {
          type: 'ProductItemAdded',
          data: { productId: 'shoes', quantity: 2, price: 100 },
        },
      ]),
    )
      .when(
        newEventsInStream('cart-123', [
          {
            type: 'ProductItemAdded',
            data: { productId: 'shirt', quantity: 1, price: 50 },
          },
        ]),
      )
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartSummary>('cart_summaries')
          .withId('cart-123')
          .toBeEqual({
            productItemsCount: 3,
            totalAmount: 250,
          }),
      ));
});
```

## Best Practices

### 1. Keep Projections Focused

```typescript
// ✅ Good: Single responsibility
const cartSummaryProjection = /* totals only */;
const cartDetailsProjection = /* full item list */;
const cartStatusProjection = /* status tracking */;

// ❌ Bad: Kitchen sink projection
const cartEverythingProjection = /* all data combined */;
```

### 2. Design for Queries

```typescript
// ✅ Good: Matches query patterns
interface ProductSalesReport {
  productId: string;
  totalQuantitySold: number;
  totalRevenue: number;
  lastSoldAt: Date;
}

// Query: "Show me best-selling products"
await productSales.find({}).sort({ totalQuantitySold: -1 }).limit(10);
```

### 3. Handle Missing Documents

```typescript
evolve: (document, event) => {
  // Always handle null case
  const current = document ?? defaultState();

  // Now safely update
  return { ...current /* updates */ };
};
```

### 4. Version Your Projections

When projection logic changes, you may need to rebuild:

```typescript
const projection = pongoSingleStreamProjection({
  collectionName: 'cart_summaries_v2', // Version in name
  // ... new logic
});
```

### 5. Consider Rebuild Strategy

For production changes:

1. Deploy new projection alongside old
2. Rebuild from event history
3. Switch reads to new projection
4. Remove old projection

## Troubleshooting

### Projection Not Updating

1. Check `canHandle` includes the event type
2. Verify event metadata has required fields
3. Check for errors in `evolve` function
4. Confirm projection is registered with event store

### Inconsistent State

1. Inline projections: Check transaction boundaries
2. Async projections: Check checkpoint progress
3. Look for duplicate event processing

### Performance Issues

1. Reduce events handled per projection
2. Use async projections for complex logic
3. Add indexes to read model collections
4. Consider batching in async projectors

## Further Reading

- [Writing and testing event-driven projections](https://event-driven.io/en/emmett_projections_testing/)
- [Using event metadata in projections](https://event-driven.io/en/projections_and_event_metadata/)
- [Getting Started - Read Models](/getting-started#read-models)

## See Also

- [Testing Patterns](/guides/testing) - Testing projections in detail
- [PostgreSQL Event Store](/event-stores/postgresql) - Pongo projections
- [API Reference: Projections](/api-reference/projections)
