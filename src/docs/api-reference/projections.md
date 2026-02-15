---
documentationType: reference
outline: deep
---

# Projections

Projections transform event streams into read-optimized views. They're the "Q" in CQRS (Command Query Responsibility Segregation).

## Overview

Projections subscribe to events and build denormalized views:

```
Events → Projection → Read Model
```

| Concept        | Purpose                                     |
| -------------- | ------------------------------------------- |
| **Projection** | Logic that transforms events into documents |
| **Read Model** | The resulting queryable data structure      |
| **Handler**    | Function that processes events              |

## Projection Types

| Type       | Execution          | Consistency | Use Case       |
| ---------- | ------------------ | ----------- | -------------- |
| **Inline** | Same transaction   | Strong      | Critical reads |
| **Async**  | Background process | Eventual    | Scalable reads |

## Core Types

### ProjectionDefinition

```typescript
interface ProjectionDefinition<
  EventType extends Event,
  EventMetaDataType extends AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord,
> {
  name?: string;
  canHandle: CanHandle<EventType>;
  handle: ProjectionHandler<
    EventType,
    EventMetaDataType,
    ProjectionHandlerContext
  >;
  truncate?: (context: ProjectionHandlerContext) => Promise<void>;
  init?: (context: ProjectionHandlerContext) => void | Promise<void>;
}
```

| Property    | Type        | Description                           |
| ----------- | ----------- | ------------------------------------- |
| `name`      | `string?`   | Unique identifier for the projection  |
| `canHandle` | `string[]`  | Event types this projection processes |
| `handle`    | `function`  | Event handler function                |
| `truncate`  | `function?` | Reset the projection state            |
| `init`      | `function?` | One-time initialization               |

### ProjectionHandler

```typescript
type ProjectionHandler<EventType, MetadataType, Context> = (
  events: ReadEvent<EventType, MetadataType>[],
  context: Context,
) => Promise<void>;
```

## Basic Usage

### Defining a Projection

```typescript
import { projection } from '@event-driven-io/emmett';

const cartSummaryProjection = projection<ShoppingCartEvent>({
  name: 'CartSummary',
  canHandle: [
    'ProductItemAdded',
    'ProductItemRemoved',
    'ShoppingCartConfirmed',
  ],
  handle: async (events, context) => {
    for (const event of events) {
      const { streamName } = event.metadata;
      const cartId = streamName.replace('shopping_cart-', '');

      switch (event.type) {
        case 'ProductItemAdded':
          await updateCartSummary(cartId, (summary) => ({
            ...summary,
            totalItems: summary.totalItems + event.data.quantity,
            totalAmount:
              summary.totalAmount + event.data.price * event.data.quantity,
          }));
          break;

        case 'ProductItemRemoved':
          await updateCartSummary(cartId, (summary) => ({
            ...summary,
            totalItems: summary.totalItems - event.data.quantity,
          }));
          break;

        case 'ShoppingCartConfirmed':
          await deleteCartSummary(cartId);
          break;
      }
    }
  },
});
```

### Registering Inline Projections

```typescript
import { inlineProjections } from '@event-driven-io/emmett';

const eventStore = getPostgreSQLEventStore(connectionString, {
  projections: inlineProjections([
    cartSummaryProjection,
    cartDetailsProjection,
  ]),
});
```

## Event Store-Specific Projections

### PostgreSQL Single-Stream Projection

```typescript
import { pongoSingleStreamProjection } from '@event-driven-io/emmett-postgresql';

const cartSummaryProjection = pongoSingleStreamProjection({
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
        };
    }
  },
});
```

### PostgreSQL Multi-Stream Projection

```typescript
import { pongoMultiStreamProjection } from '@event-driven-io/emmett-postgresql';

const productSalesProjection = pongoMultiStreamProjection({
  collectionName: 'product_sales',
  getDocumentId: (event) => event.data.productId,
  canHandle: ['ProductItemAdded'],
  evolve: (document, event) => {
    const current = document ?? {
      productId: event.data.productId,
      totalSold: 0,
    };
    return {
      ...current,
      totalSold: current.totalSold + event.data.quantity,
    };
  },
});
```

### SQLite Projection

```typescript
import { sqliteSingleStreamProjection } from '@event-driven-io/emmett-sqlite';

const cartProjection = sqliteSingleStreamProjection<
  CartSummary,
  ShoppingCartEvent
>({
  tableName: 'cart_summaries',
  canHandle: ['ProductItemAdded', 'ProductItemRemoved'],
  evolve: (document, event) => {
    // Same evolve logic as PostgreSQL
  },
});
```

## Async Projections (Consumers)

Process events in the background:

```typescript
const consumer = eventStore.consumer();

consumer.projector({
  processorId: 'CartAnalytics',
  projection: {
    name: 'CartAnalytics',
    canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
    handle: async (events, context) => {
      for (const event of events) {
        await analyticsService.track(event);
      }
    },
  },
});

await consumer.start();
```

### Consumer Configuration

```typescript
const consumer = eventStore.consumer({
  pollingIntervalMs: 100, // How often to check for new events
  batchSize: 100, // Max events per batch
  eagerCheckpoint: false, // Checkpoint after each batch vs per event
});
```

## Projection Helpers

### Creating Projection Registrations

```typescript
import { projections } from '@event-driven-io/emmett';

// Inline projections (same transaction)
const inlineRegs = projections.inline([projection1, projection2]);

// Async projections (background)
const asyncRegs = projections.async([asyncProjection1, asyncProjection2]);
```

## Testing Projections

### PostgreSQL Projection Testing

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
    given = PostgreSQLProjectionSpec.for({
      projection: cartSummaryProjection,
      connectionString: testConnectionString,
    });
  });

  it('creates summary on first product', () =>
    given([])
      .when([
        {
          type: 'ProductItemAdded',
          data: { productId: 'shoes', quantity: 2, price: 100 },
          metadata: { streamName: 'shopping_cart-123' },
        },
      ])
      .then(
        expectPongoDocuments
          .fromCollection<CartSummary>('cart_summaries')
          .withId('123')
          .toBeEqual({ totalItems: 2, totalAmount: 200 }),
      ));

  it('updates summary on additional products', () =>
    given(
      eventsInStream('shopping_cart-123', [
        {
          type: 'ProductItemAdded',
          data: { productId: 'shoes', quantity: 2, price: 100 },
        },
      ]),
    )
      .when(
        newEventsInStream('shopping_cart-123', [
          {
            type: 'ProductItemAdded',
            data: { productId: 'shirt', quantity: 1, price: 50 },
          },
        ]),
      )
      .then(
        expectPongoDocuments
          .fromCollection<CartSummary>('cart_summaries')
          .withId('123')
          .toBeEqual({ totalItems: 3, totalAmount: 250 }),
      ));
});
```

### In-Memory Projection Testing

```typescript
import { InMemoryProjectionSpec } from '@event-driven-io/emmett';

const given = InMemoryProjectionSpec.for({
  projection: myProjection,
});

it('handles events', () =>
  given([])
    .when([event1, event2])
    .then((result) => {
      expect(result.documents).toHaveLength(1);
    }));
```

## Evolve Pattern

The `evolve` pattern simplifies projection logic:

```typescript
type Evolve<Document, EventType> = (
  document: Document | null,
  event: EventType,
) => Document | null;
```

- **Input null**: Document doesn't exist, create it
- **Output null**: Delete the document
- **Output document**: Upsert the document

```typescript
const evolve = (document: CartSummary | null, event: ShoppingCartEvent) => {
  switch (event.type) {
    case 'ProductItemAdded':
      const current = document ?? { totalItems: 0, totalAmount: 0 };
      return {
        ...current,
        totalItems: current.totalItems + event.data.quantity,
      };

    case 'ShoppingCartConfirmed':
      return null; // Delete document

    default:
      return document;
  }
};
```

## Best Practices

### 1. Name Your Projections

```typescript
// ✅ Good: Named projection
const cartSummary = projection({
  name: 'CartSummary',
  canHandle: ['ProductItemAdded'],
  handle: async (events) => {
    /* ... */
  },
});

// ❌ Bad: Anonymous projection
const cartSummary = projection({
  canHandle: ['ProductItemAdded'],
  handle: async (events) => {
    /* ... */
  },
});
```

### 2. Be Specific with canHandle

```typescript
// ✅ Good: Only handle needed events
const projection = {
  canHandle: ['ProductItemAdded', 'ProductItemRemoved'],
  handle: (events) => {
    /* ... */
  },
};

// ❌ Bad: Handle all events
const projection = {
  canHandle: ['*'], // Don't do this
  handle: (events) => {
    /* ... */
  },
};
```

### 3. Handle Idempotency

```typescript
const handle = async (events, context) => {
  for (const event of events) {
    const { streamPosition } = event.metadata;

    // Check if already processed
    const existing = await getDocument(id);
    if (existing?.lastProcessedPosition >= streamPosition) {
      continue; // Already processed
    }

    await updateDocument(id, {
      ...newData,
      lastProcessedPosition: streamPosition,
    });
  }
};
```

### 4. Use Batch Processing

```typescript
// ✅ Good: Batch operations
const handle = async (events, context) => {
  const updates = events.map((e) => ({
    id: e.metadata.streamName,
    data: transform(e),
  }));
  await bulkUpdate(updates);
};

// ❌ Bad: Individual operations
const handle = async (events, context) => {
  for (const event of events) {
    await update(event); // N database calls
  }
};
```

## See Also

- [Projections Guide](/guides/projections) - Detailed patterns and strategies
- [PostgreSQL Event Store](/event-stores/postgresql) - Pongo projections
- [Testing Patterns](/guides/testing) - Testing projections
- [Writing and testing event-driven projections](https://event-driven.io/en/emmett_projections_testing/)
