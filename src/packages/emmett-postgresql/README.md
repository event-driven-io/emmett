# @event-driven-io/emmett-postgresql

PostgreSQL adapter for the Emmett event sourcing library, providing persistent event storage with partitioned tables, inline projections, and async message consumers.

## Purpose

This package implements the Emmett `EventStore` interface for PostgreSQL databases. It provides:

- Persistent event stream storage with optimistic concurrency control
- Partitioned tables for multi-tenant and module isolation
- Inline projections that execute within the append transaction
- Async message consumers with batch processing and checkpointing
- Pongo integration for document-style projections using PostgreSQL JSONB
- CLI plugin for database migrations

## Key Concepts

### Event Store

The PostgreSQL event store persists events in partitioned tables (`emt_streams`, `emt_messages`, `emt_subscriptions`). Events are stored with:

- **Stream ID**: Unique identifier for the event stream
- **Stream Position**: Sequential position within the stream (BigInt)
- **Global Position**: Sequential position across all streams for ordering
- **Message Data**: Event payload stored as JSONB
- **Message Metadata**: Additional metadata stored as JSONB

### Projections

Two types of projections are supported:

- **Inline Projections**: Execute within the same transaction as the event append, ensuring consistency
- **Async Projections**: Process events asynchronously via consumers with checkpointing

### Consumers and Processors

Message consumers poll the event store and delegate to processors:

- **Projector**: Updates read models based on events
- **Reactor**: Triggers side effects or workflows in response to events

### Multi-Tenancy

Partitioned tables support tenant and module isolation through PostgreSQL table partitioning.

## Installation

```bash
npm install @event-driven-io/emmett-postgresql
# or
pnpm add @event-driven-io/emmett-postgresql
# or
yarn add @event-driven-io/emmett-postgresql
```

### Peer Dependencies

```bash
npm install @event-driven-io/emmett @event-driven-io/pongo
```

## Quick Start

### Basic Event Store Setup

```typescript
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

// Create the event store
const eventStore = getPostgreSQLEventStore(
  'postgresql://user:password@localhost:5432/mydb',
);

// Schema is auto-migrated by default
// To manually control migration:
await eventStore.schema.migrate();
```

### Appending Events

```typescript
import { type Event } from '@event-driven-io/emmett';

// Define your events
type ProductItemAdded = Event<
  'ProductItemAdded',
  { productId: string; quantity: number }
>;

type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { confirmedAt: Date }
>;

type ShoppingCartEvent = ProductItemAdded | ShoppingCartConfirmed;

// Append events to a stream
const result = await eventStore.appendToStream<ShoppingCartEvent>(
  'ShoppingCart-123',
  [
    {
      type: 'ProductItemAdded',
      data: { productId: 'product-1', quantity: 2 },
    },
  ],
);

console.log(result.nextExpectedStreamVersion); // 1n
console.log(result.lastEventGlobalPosition); // Global position for ordering
```

### Reading Events

```typescript
// Read all events from a stream
const { events, currentStreamVersion } =
  await eventStore.readStream<ShoppingCartEvent>('ShoppingCart-123');

for (const event of events) {
  console.log(event.type, event.data);
}
```

### Aggregating State

```typescript
import { type Decider } from '@event-driven-io/emmett';

interface ShoppingCart {
  items: Map<string, number>;
  status: 'Open' | 'Confirmed';
}

const evolve = (
  state: ShoppingCart,
  event: ShoppingCartEvent,
): ShoppingCart => {
  switch (event.type) {
    case 'ProductItemAdded':
      state.items.set(
        event.data.productId,
        (state.items.get(event.data.productId) ?? 0) + event.data.quantity,
      );
      return state;
    case 'ShoppingCartConfirmed':
      return { ...state, status: 'Confirmed' };
  }
};

const { state, currentStreamVersion } = await eventStore.aggregateStream(
  'ShoppingCart-123',
  {
    evolve,
    initialState: () => ({ items: new Map(), status: 'Open' }),
  },
);
```

### Optimistic Concurrency

```typescript
// Append with expected version check
await eventStore.appendToStream(
  'ShoppingCart-123',
  [{ type: 'ShoppingCartConfirmed', data: { confirmedAt: new Date() } }],
  { expectedStreamVersion: 1n },
);

// Throws ExpectedVersionConflictError if version doesn't match
```

## How-to Guides

### Setting Up Inline Projections

Inline projections execute within the append transaction for strong consistency.

```typescript
import {
  getPostgreSQLEventStore,
  pongoSingleStreamProjection,
} from '@event-driven-io/emmett-postgresql';

// Define projection document
interface ShoppingCartDetails {
  _id: string;
  items: Array<{ productId: string; quantity: number }>;
  status: string;
  totalItems: number;
}

// Create projection
const shoppingCartDetailsProjection = pongoSingleStreamProjection<
  ShoppingCartDetails,
  ShoppingCartEvent
>({
  collectionName: 'shoppingCartDetails',
  evolve: (document, event) => {
    switch (event.type) {
      case 'ProductItemAdded': {
        const items = document?.items ?? [];
        items.push({
          productId: event.data.productId,
          quantity: event.data.quantity,
        });
        return {
          _id: event.metadata.streamName,
          items,
          status: 'Open',
          totalItems: items.reduce((sum, i) => sum + i.quantity, 0),
        };
      }
      case 'ShoppingCartConfirmed':
        return document ? { ...document, status: 'Confirmed' } : null;
    }
  },
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
});

// Register with event store
const eventStore = getPostgreSQLEventStore(connectionString, {
  projections: [{ type: 'inline', projection: shoppingCartDetailsProjection }],
});
```

### Setting Up Async Consumers

```typescript
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

const eventStore = getPostgreSQLEventStore(connectionString);

// Create a consumer
const consumer = eventStore.consumer();

// Add a projector
consumer.projector({
  processorId: 'shopping-cart-summary',
  projection: {
    name: 'ShoppingCartSummary',
    canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
    handle: async (events, { execute }) => {
      for (const event of events) {
        // Update your read model
        await execute.command(/* SQL to update read model */);
      }
    },
  },
});

// Add a reactor for side effects
consumer.reactor({
  processorId: 'order-notification',
  eachMessage: async (message, context) => {
    if (message.type === 'ShoppingCartConfirmed') {
      // Send notification, trigger workflow, etc.
      console.log('Cart confirmed:', message.metadata.streamName);
    }
  },
  canHandle: ['ShoppingCartConfirmed'],
});

// Start consuming
await consumer.start();

// Stop when done
await consumer.stop();
```

### Multi-Stream Projections with Pongo

```typescript
import { pongoMultiStreamProjection } from '@event-driven-io/emmett-postgresql';

// Project events from multiple streams into documents keyed by custom ID
const productSalesProjection = pongoMultiStreamProjection<
  { _id: string; productId: string; totalSold: number },
  ProductItemAdded
>({
  collectionName: 'productSales',
  canHandle: ['ProductItemAdded'],
  getDocumentId: (event) => event.data.productId, // Custom document ID
  evolve: (document, event) => ({
    _id: event.data.productId,
    productId: event.data.productId,
    totalSold: (document?.totalSold ?? 0) + event.data.quantity,
  }),
  initialState: () => ({ _id: '', productId: '', totalSold: 0 }),
});
```

### Using Sessions for Transactions

```typescript
// Execute multiple operations in a single transaction
await eventStore.withSession(async ({ eventStore: sessionStore }) => {
  await sessionStore.appendToStream('Cart-1', [event1]);
  await sessionStore.appendToStream('Cart-2', [event2]);
  // Both appends succeed or fail together
});
```

### CLI Migration Commands

The package provides CLI commands via the Emmett CLI plugin:

```bash
# Run migrations
npx emmett migrate run --connectionString "postgresql://..."

# Generate migration SQL
npx emmett migrate sql --print
```

## API Reference

### `getPostgreSQLEventStore(connectionString, options?)`

Creates a PostgreSQL event store instance.

**Parameters:**

- `connectionString: string` - PostgreSQL connection string
- `options?: PostgresEventStoreOptions`
  - `projections?: ProjectionRegistration[]` - Inline projections to register
  - `schema?: { autoMigration?: MigrationStyle }` - Schema migration settings (`'CreateOrUpdate'` | `'None'`)
  - `connectionOptions?: PostgresEventStoreConnectionOptions` - Connection pool settings

**Returns:** `PostgresEventStore`

### `PostgresEventStore`

#### Methods

| Method                                         | Description                         |
| ---------------------------------------------- | ----------------------------------- |
| `appendToStream(streamName, events, options?)` | Append events to a stream           |
| `readStream(streamName, options?)`             | Read events from a stream           |
| `aggregateStream(streamName, options)`         | Aggregate events into state         |
| `consumer(options?)`                           | Create an async message consumer    |
| `withSession(callback)`                        | Execute operations in a transaction |
| `schema.migrate()`                             | Run schema migrations               |
| `schema.sql()`                                 | Get schema SQL                      |
| `close()`                                      | Close connections                   |

### Projection Functions

| Function                               | Description                                             |
| -------------------------------------- | ------------------------------------------------------- |
| `pongoSingleStreamProjection(options)` | Project single stream to document (ID from stream name) |
| `pongoMultiStreamProjection(options)`  | Project multiple streams to documents (custom ID)       |
| `pongoProjection(options)`             | Low-level Pongo projection                              |
| `postgreSQLProjection(options)`        | Raw PostgreSQL projection                               |
| `postgreSQLRawSQLProjection(options)`  | Execute raw SQL in projection                           |

### Consumer Functions

| Function                                | Description                |
| --------------------------------------- | -------------------------- |
| `postgreSQLEventStoreConsumer(options)` | Create standalone consumer |
| `postgreSQLProjector(options)`          | Create projector processor |
| `postgreSQLReactor(options)`            | Create reactor processor   |

## Architecture

### Database Schema

The event store uses three partitioned tables:

```
emt_streams          - Stream metadata and positions
emt_messages         - Event/message storage
emt_subscriptions    - Consumer checkpoint tracking
```

Each table is partitioned by a `partition` column for multi-tenant isolation.

### Message Flow

```
                    +-----------------+
                    |   Application   |
                    +--------+--------+
                             |
              +--------------+--------------+
              |                             |
    +---------v---------+       +-----------v-----------+
    |   appendToStream  |       |      Consumer         |
    |   (with inline    |       |   (polling loop)      |
    |    projections)   |       +----------+------------+
    +---------+---------+                  |
              |                  +---------+---------+
              |                  |                   |
    +---------v---------+   +----v----+       +------v------+
    |   emt_messages    |   |Projector|       |   Reactor   |
    |   (PostgreSQL)    |   +---------+       +-------------+
    +-------------------+        |
                           +-----v-----+
                           | Read Model|
                           +-----------+
```

### Connection Management

The event store supports both pooled and non-pooled connections:

- **Pooled (default)**: Uses `pg.Pool` for connection pooling
- **Non-pooled**: Uses a single `pg.Client` for dedicated connections

## Dependencies

### Peer Dependencies

| Package                   | Version  | Purpose                         |
| ------------------------- | -------- | ------------------------------- |
| `@event-driven-io/emmett` | `0.38.3` | Core event sourcing library     |
| `@event-driven-io/pongo`  | `0.16.4` | MongoDB-like API for PostgreSQL |

### Internal Dependencies

| Package                  | Purpose                                   |
| ------------------------ | ----------------------------------------- |
| `@event-driven-io/dumbo` | PostgreSQL database utilities (via pongo) |

### External Dependencies

| Package     | Purpose                       |
| ----------- | ----------------------------- |
| `pg`        | PostgreSQL client for Node.js |
| `uuid`      | UUID generation (v4 and v7)   |
| `commander` | CLI command parsing           |

## Related Packages

- [`@event-driven-io/emmett`](https://www.npmjs.com/package/@event-driven-io/emmett) - Core library
- [`@event-driven-io/pongo`](https://www.npmjs.com/package/@event-driven-io/pongo) - Document projections
- [`@event-driven-io/emmett-testcontainers`](https://www.npmjs.com/package/@event-driven-io/emmett-testcontainers) - Testing utilities
