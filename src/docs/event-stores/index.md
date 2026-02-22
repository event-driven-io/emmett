---
documentationType: reference
outline: deep
---

# Event Stores

Emmett provides multiple event store implementations to fit your infrastructure and requirements.

## Overview

All event stores implement the same `EventStore` interface, making it easy to switch between them:

```typescript
interface EventStore {
  // Append events to a stream
  appendToStream(
    streamName: string,
    events: Event[],
    options?: AppendOptions,
  ): Promise<AppendResult>;

  // Read events from a stream
  readStream(streamName: string, options?: ReadOptions): Promise<ReadResult>;

  // Aggregate events into state
  aggregateStream(
    streamName: string,
    options: AggregateOptions,
  ): Promise<AggregateResult>;
}
```

## Quick Comparison

| Store                                  | Best For         | Persistence | Transactions   | Scaling     |
| -------------------------------------- | ---------------- | ----------- | -------------- | ----------- |
| [PostgreSQL](/event-stores/postgresql) | Production apps  | Yes         | Full ACID      | Horizontal  |
| [EventStoreDB](/event-stores/esdb)     | Native ES        | Yes         | Stream-level   | Cluster     |
| [MongoDB](/event-stores/mongodb)       | Document-centric | Yes         | Document-level | Horizontal  |
| [SQLite](/event-stores/sqlite)         | Dev/embedded     | Yes         | Full ACID      | Single node |
| In-Memory                              | Testing          | No          | N/A            | N/A         |

## Installation

Each event store is a separate package:

::: code-group

```bash [PostgreSQL]
npm install @event-driven-io/emmett-postgresql
```

```bash [EventStoreDB]
npm install @event-driven-io/emmett-esdb
```

```bash [MongoDB]
npm install @event-driven-io/emmett-mongodb
```

```bash [SQLite]
npm install @event-driven-io/emmett-sqlite
```

```bash [In-Memory]
# Included in core package
npm install @event-driven-io/emmett
```

:::

## Quick Setup

::: code-group

```typescript [PostgreSQL]
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

const eventStore = getPostgreSQLEventStore(
  'postgresql://user:password@localhost:5432/mydb',
);
```

```typescript [EventStoreDB]
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import { EventStoreDBClient } from '@eventstore/db-client';

const client = EventStoreDBClient.connectionString(
  'esdb://localhost:2113?tls=false',
);
const eventStore = getEventStoreDBEventStore(client);
```

```typescript [MongoDB]
import { getMongoDBEventStore } from '@event-driven-io/emmett-mongodb';

const eventStore = getMongoDBEventStore({
  connectionString: 'mongodb://localhost:27017',
  database: 'events',
});
```

```typescript [SQLite]
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';

const eventStore = getSQLiteEventStore('./events.db');
// or in-memory: getSQLiteEventStore(':memory:')
```

```typescript [In-Memory]
import { getInMemoryEventStore } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();
```

:::

## Common Operations

### Appending Events

```typescript
const result = await eventStore.appendToStream(
  'shopping_cart-123',
  [
    {
      type: 'ProductItemAdded',
      data: { productId: 'shoes', quantity: 1, price: 99 },
    },
    {
      type: 'ProductItemAdded',
      data: { productId: 'shirt', quantity: 2, price: 49 },
    },
  ],
  { expectedStreamVersion: 0n },
);

console.log(result.nextExpectedStreamVersion); // 2n
```

### Reading Events

```typescript
const { events, currentStreamVersion } =
  await eventStore.readStream('shopping_cart-123');

for (const event of events) {
  console.log(`${event.type}: ${JSON.stringify(event.data)}`);
}
```

### Aggregating State

```typescript
const { state, currentStreamVersion } = await eventStore.aggregateStream(
  'shopping_cart-123',
  {
    evolve: (state, event) => {
      switch (event.type) {
        case 'ProductItemAdded':
          return {
            ...state,
            items: [...state.items, event.data],
            total: state.total + event.data.price * event.data.quantity,
          };
        default:
          return state;
      }
    },
    initialState: () => ({ items: [], total: 0 }),
  },
);
```

## Optimistic Concurrency

All event stores support optimistic concurrency control:

```typescript
import { STREAM_DOES_NOT_EXIST, STREAM_EXISTS } from '@event-driven-io/emmett';

// Require stream to not exist (create new)
await eventStore.appendToStream(streamName, events, {
  expectedStreamVersion: STREAM_DOES_NOT_EXIST,
});

// Require stream to exist (update)
await eventStore.appendToStream(streamName, events, {
  expectedStreamVersion: STREAM_EXISTS,
});

// Require specific version
await eventStore.appendToStream(streamName, events, {
  expectedStreamVersion: 5n,
});

// Skip concurrency check
await eventStore.appendToStream(streamName, events, {
  expectedStreamVersion: NO_CONCURRENCY_CHECK,
});
```

## Choosing an Event Store

See [Choosing an Event Store](/guides/choosing-event-store) for detailed guidance on selecting the right event store for your project.

## Detailed Documentation

- [PostgreSQL Event Store](/event-stores/postgresql) - Full ACID, Pongo projections
- [EventStoreDB Event Store](/event-stores/esdb) - Native ES, subscriptions
- [MongoDB Event Store](/event-stores/mongodb) - Document-centric, flexible
- [SQLite Event Store](/event-stores/sqlite) - Embedded, lightweight
