# @event-driven-io/emmett-sqlite

SQLite event store adapter for the Emmett event sourcing library, providing persistent event storage with stream management, projections, and subscription-based event processing.

## Purpose

This package provides a SQLite-based implementation of the Emmett event store interface. It enables event sourcing applications to persist events to a SQLite database with support for:

- File-based and in-memory database storage
- WAL (Write-Ahead Logging) mode for improved concurrency
- Automatic schema management
- Inline and async projections for read models
- Polling-based consumers for background event processing
- Optimistic concurrency control

SQLite is an excellent choice for development, testing, embedded applications, and scenarios where a lightweight, serverless database is preferred.

## Key Concepts

### Event Store

The `SQLiteEventStore` interface extends Emmett's base `EventStore` with SQLite-specific functionality:

- **Append events** to streams with optimistic concurrency control
- **Read streams** to retrieve events for a specific aggregate
- **Aggregate streams** to rebuild state using an evolve function
- **Consumer** for background event processing

### Database Schema

The event store uses three tables (prefixed with `emt_`):

| Table | Purpose |
|-------|---------|
| `emt_streams` | Stream metadata (stream ID, position, type) |
| `emt_messages` | Events with global position ordering |
| `emt_subscriptions` | Processor checkpoint positions |

### Consumers and Processors

- **Consumer**: Coordinates multiple processors, manages polling lifecycle
- **Processor**: Handles event batches, maintains checkpoint position
- **Projection Processor**: Specialized processor for updating read models

### Projections

Two projection types are supported:

- **Inline projections**: Execute within the append transaction for immediate consistency
- **Async projections**: Run via consumers for eventual consistency

## Installation

```bash
npm install @event-driven-io/emmett-sqlite
# or
pnpm add @event-driven-io/emmett-sqlite
# or
yarn add @event-driven-io/emmett-sqlite
```

### Peer Dependencies

This package requires the following peer dependencies:

```bash
npm install @event-driven-io/emmett sqlite3
```

## Quick Start

### Basic Event Store Setup

```typescript
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';

// File-based database
const eventStore = getSQLiteEventStore({
  fileName: './events.db',
  schema: {
    autoMigration: 'CreateOrUpdate', // Automatically create tables
  },
});

// In-memory database (useful for testing)
import { InMemorySQLiteDatabase } from '@event-driven-io/emmett-sqlite';

const inMemoryEventStore = getSQLiteEventStore({
  fileName: InMemorySQLiteDatabase, // ':memory:'
  schema: {
    autoMigration: 'CreateOrUpdate',
  },
});
```

### Appending Events

```typescript
import type { Event } from '@event-driven-io/emmett';

// Define your event types
type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: { productId: string; quantity: number; price: number } }
>;

type DiscountApplied = Event<
  'DiscountApplied',
  { percent: number; couponId: string }
>;

type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

// Append events to a stream
const streamId = 'shopping_cart-123';

const result = await eventStore.appendToStream<ShoppingCartEvent>(
  streamId,
  [
    {
      type: 'ProductItemAdded',
      data: {
        productItem: { productId: 'shoes', quantity: 2, price: 100 },
      },
    },
  ],
);

// Append with optimistic concurrency
await eventStore.appendToStream<ShoppingCartEvent>(
  streamId,
  [
    {
      type: 'DiscountApplied',
      data: { percent: 10, couponId: 'SAVE10' },
    },
  ],
  { expectedStreamVersion: result.nextExpectedStreamVersion },
);
```

### Reading Events

```typescript
// Read all events from a stream
const { events, currentStreamVersion } = await eventStore.readStream(streamId);

for (const event of events) {
  console.log(`Event: ${event.type}`, event.data);
}
```

### Aggregating State

```typescript
type ShoppingCart = {
  productItems: Array<{ productId: string; quantity: number; price: number }>;
  totalAmount: number;
};

const evolve = (state: ShoppingCart, event: ShoppingCartEvent): ShoppingCart => {
  switch (event.type) {
    case 'ProductItemAdded': {
      const item = event.data.productItem;
      return {
        productItems: [...state.productItems, item],
        totalAmount: state.totalAmount + item.price * item.quantity,
      };
    }
    case 'DiscountApplied':
      return {
        ...state,
        totalAmount: state.totalAmount * (1 - event.data.percent / 100),
      };
  }
};

const initialState = (): ShoppingCart => ({
  productItems: [],
  totalAmount: 0,
});

const { state, currentStreamVersion } = await eventStore.aggregateStream(
  streamId,
  { evolve, initialState },
);

console.log('Cart total:', state.totalAmount);
```

## How-to Guides

### Using Inline Projections

Inline projections execute within the same transaction as the event append, ensuring immediate consistency.

```typescript
import {
  getSQLiteEventStore,
  sqliteRawSQLProjection,
} from '@event-driven-io/emmett-sqlite';

const shoppingCartSummaryProjection = sqliteRawSQLProjection<ShoppingCartEvent>(
  (event, context) => {
    switch (event.type) {
      case 'ProductItemAdded': {
        const { quantity, price } = event.data.productItem;
        return `
          INSERT INTO shopping_cart_summary (id, item_count, total)
          VALUES ('${event.metadata.streamName}', ${quantity}, ${quantity * price})
          ON CONFLICT (id) DO UPDATE SET
            item_count = item_count + ${quantity},
            total = total + ${quantity * price};
        `;
      }
      case 'DiscountApplied':
        return `
          UPDATE shopping_cart_summary
          SET total = total * (100 - ${event.data.percent}) / 100
          WHERE id = '${event.metadata.streamName}';
        `;
    }
  },
  'ProductItemAdded',
  'DiscountApplied',
);

const eventStore = getSQLiteEventStore({
  fileName: './events.db',
  projections: [
    { type: 'inline', projection: shoppingCartSummaryProjection },
  ],
});
```

### Using Background Consumers

Consumers poll for new events and process them with registered processors.

```typescript
import { getSQLiteEventStore, sqliteProcessor } from '@event-driven-io/emmett-sqlite';

const eventStore = getSQLiteEventStore({
  fileName: './events.db',
});

// Create a consumer
const consumer = eventStore.consumer<ShoppingCartEvent>();

// Register a processor
consumer.processor({
  processorId: 'notification-sender',
  eachMessage: async (event, context) => {
    if (event.type === 'ProductItemAdded') {
      console.log('New item added:', event.data.productItem);
      // Send notification, update cache, etc.
    }
  },
});

// Start consuming
await consumer.start();

// Stop when done
await consumer.stop();
await consumer.close();
```

### Using Projection Processors

Projection processors provide a convenient way to run projections asynchronously.

```typescript
import { sqliteProjectionProcessor } from '@event-driven-io/emmett-sqlite';

const consumer = eventStore.consumer<ShoppingCartEvent>();

consumer.processor({
  projection: shoppingCartSummaryProjection,
  processorId: 'cart-summary-projection',
  startFrom: 'CURRENT', // Resume from last checkpoint
});

await consumer.start();
```

### Configuring Polling Behavior

```typescript
const consumer = eventStore.consumer<ShoppingCartEvent>({
  pulling: {
    batchSize: 100,           // Events per batch (default: 100)
    pullingFrequencyInMs: 50, // Polling interval (default: 50ms)
  },
});
```

### Manual Schema Management

```typescript
import {
  getSQLiteEventStore,
  sqliteConnection,
  createEventStoreSchema,
} from '@event-driven-io/emmett-sqlite';

// Create connection
const connection = sqliteConnection({ fileName: './events.db' });

// Manually create schema
await createEventStoreSchema(connection);

// Create event store without auto-migration
const eventStore = getSQLiteEventStore({
  fileName: './events.db',
  schema: {
    autoMigration: 'None',
  },
});
```

### Using Shared In-Memory Database

For testing scenarios where multiple connections need to share the same in-memory database:

```typescript
import { InMemorySharedCacheSQLiteDatabase } from '@event-driven-io/emmett-sqlite';

const eventStore = getSQLiteEventStore({
  fileName: InMemorySharedCacheSQLiteDatabase, // 'file::memory:?cache=shared'
});
```

### Using Before-Commit Hooks

Execute custom logic before events are committed:

```typescript
const eventStore = getSQLiteEventStore({
  fileName: './events.db',
  hooks: {
    onBeforeCommit: async (events, context) => {
      // Custom validation, logging, or side effects
      for (const event of events) {
        console.log('About to commit:', event.type);
      }
    },
  },
});
```

## API Reference

### getSQLiteEventStore

Creates a new SQLite event store instance.

```typescript
function getSQLiteEventStore(options: SQLiteEventStoreOptions): SQLiteEventStore;
```

**Options:**

| Property | Type | Description |
|----------|------|-------------|
| `fileName` | `string \| ':memory:' \| 'file::memory:?cache=shared'` | Database file path or in-memory identifier |
| `schema.autoMigration` | `'None' \| 'CreateOrUpdate'` | Schema creation mode (default: `'CreateOrUpdate'`) |
| `projections` | `ProjectionRegistration[]` | Inline projections to register |
| `hooks.onBeforeCommit` | `BeforeEventStoreCommitHandler` | Hook called before event commit |

### SQLiteEventStore

| Method | Description |
|--------|-------------|
| `appendToStream(streamName, events, options?)` | Append events to a stream |
| `readStream(streamName, options?)` | Read events from a stream |
| `aggregateStream(streamName, options)` | Rebuild state from events |
| `consumer(options?)` | Create an event consumer |

### sqliteConnection

Creates a SQLite database connection with transaction support.

```typescript
function sqliteConnection(options: { fileName: string }): SQLiteConnection;
```

**SQLiteConnection interface:**

| Method | Description |
|--------|-------------|
| `command(sql, params?)` | Execute a write command |
| `query<T>(sql, params?)` | Execute a query returning multiple rows |
| `querySingle<T>(sql, params?)` | Execute a query returning a single row |
| `withTransaction<T>(fn)` | Execute function within a transaction |
| `close()` | Close the connection |

### Projection Helpers

| Function | Description |
|----------|-------------|
| `sqliteProjection(definition)` | Create a projection definition |
| `sqliteRawSQLProjection(handler, ...eventTypes)` | Create projection returning raw SQL per event |
| `sqliteRawBatchSQLProjection(handler, ...eventTypes)` | Create projection returning raw SQL array for batch |

### Consumer Types

| Type | Description |
|------|-------------|
| `SQLiteEventStoreConsumer` | Consumer interface with start/stop lifecycle |
| `SQLiteProcessor` | Processor interface for handling event batches |
| `SQLiteProjectionDefinition` | Projection definition type |

## Architecture

```
                                    +------------------+
                                    |   Application    |
                                    +--------+---------+
                                             |
                           +--------+--------+--------+
                           |                          |
                    Commands/Queries            Consumers
                           |                          |
              +------------v------------+    +--------v--------+
              |    SQLiteEventStore     |    | SQLiteConsumer  |
              |  - appendToStream()     |    |  - processor()  |
              |  - readStream()         |    |  - start()      |
              |  - aggregateStream()    |    |  - stop()       |
              +------------+------------+    +--------+--------+
                           |                          |
                           +------------+-------------+
                                        |
                              +---------v---------+
                              |  SQLiteConnection |
                              |  - command()      |
                              |  - query()        |
                              |  - withTransaction|
                              +---------+---------+
                                        |
                              +---------v---------+
                              |      SQLite       |
                              |   (WAL mode)      |
                              |                   |
                              | +---------------+ |
                              | | emt_streams   | |
                              | +---------------+ |
                              | | emt_messages  | |
                              | +---------------+ |
                              | | emt_subscript | |
                              | +---------------+ |
                              +-------------------+
```

### Event Flow

1. **Write Path**: Events are appended via `appendToStream()`, stored in `emt_messages` with auto-incremented global position
2. **Read Path**: Events are read via `readStream()` or `aggregateStream()` for state reconstruction
3. **Projection Path (Inline)**: Projections execute within the append transaction
4. **Projection Path (Async)**: Consumers poll `emt_messages`, processors handle batches, checkpoints stored in `emt_subscriptions`

### Concurrency Model

- SQLite WAL mode enables concurrent reads during writes
- Optimistic concurrency via expected stream version checks
- Consumers use polling (not push) for event delivery
- Processor checkpoints enable resume-from-position

## Dependencies

### Peer Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@event-driven-io/emmett` | `0.38.3` | Core event sourcing types and utilities |
| `sqlite3` | `^5.1.7` | SQLite database driver |

### Internal Dependencies

| Package | Purpose |
|---------|---------|
| `@event-driven-io/dumbo` | SQL utilities |
| `uuid` | Message ID generation |

## Related Packages

- [@event-driven-io/emmett](https://www.npmjs.com/package/@event-driven-io/emmett) - Core library
- [@event-driven-io/emmett-postgresql](https://www.npmjs.com/package/@event-driven-io/emmett-postgresql) - PostgreSQL adapter
- [@event-driven-io/emmett-mongodb](https://www.npmjs.com/package/@event-driven-io/emmett-mongodb) - MongoDB adapter
- [@event-driven-io/emmett-esdb](https://www.npmjs.com/package/@event-driven-io/emmett-esdb) - EventStoreDB adapter