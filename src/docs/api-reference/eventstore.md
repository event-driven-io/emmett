---
documentationType: reference
outline: deep
---

# Event Store

The event store is the persistence layer for Event Sourcing. It stores events in append-only streams.

## Overview

Event stores are fundamentally key-value databases where:

- **Key** = Stream name (e.g., `shopping_cart-123`)
- **Value** = Ordered list of events

Each stream represents a single aggregate's history. Events are appended atomically and can never be modified or deleted.

Read more: [Event stores are key-value databases](https://event-driven.io/en/event_stores_are_key_value_stores/)

## Interface

```typescript
interface EventStore<ReadEventMetadataType extends AnyReadEventMetadata> {
  readStream<EventType extends Event>(
    streamName: string,
    options?: ReadStreamOptions,
  ): Promise<ReadStreamResult<EventType, ReadEventMetadataType>>;

  appendToStream<EventType extends Event>(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions,
  ): Promise<AppendToStreamResult>;

  aggregateStream<State, EventType extends Event>(
    streamName: string,
    options: AggregateStreamOptions<State, EventType, ReadEventMetadataType>,
  ): Promise<AggregateStreamResult<State>>;
}
```

## Core Methods

### readStream

Reads events from a stream.

```typescript
const result =
  await eventStore.readStream<ShoppingCartEvent>('shopping_cart-123');

console.log(result.events); // Array of events
console.log(result.currentStreamVersion); // Current stream version (bigint)
console.log(result.streamExists); // true if stream exists
```

#### Reading Options

```typescript
// Read from specific position
const { events } = await eventStore.readStream('stream-1', {
  from: 5n, // Start from position 5
});

// Read up to specific position
const { events } = await eventStore.readStream('stream-1', {
  to: 10n, // Read up to position 10
});

// Read with limit
const { events } = await eventStore.readStream('stream-1', {
  from: 0n,
  maxCount: 100n, // Max 100 events
});

// With expected version (for optimistic concurrency)
const { events } = await eventStore.readStream('stream-1', {
  expectedStreamVersion: 5n, // Throws if version doesn't match
});
```

### appendToStream

Appends events to the end of a stream.

```typescript
const result = await eventStore.appendToStream<ShoppingCartEvent>(
  'shopping_cart-123',
  [
    {
      type: 'ProductItemAdded',
      data: { productId: 'shoes-1', quantity: 2, price: 99.99 },
    },
  ],
);

console.log(result.nextExpectedStreamVersion); // Version after append (bigint)
console.log(result.createdNewStream); // true if stream was created
```

#### Optimistic Concurrency

```typescript
// Require specific version before appending
const result = await eventStore.appendToStream(
  'shopping_cart-123',
  [newEvent],
  { expectedStreamVersion: 5n },
);
// Throws ConcurrencyError if current version !== 5n

// Require stream doesn't exist
await eventStore.appendToStream('new-stream', [firstEvent], {
  expectedStreamVersion: 'no_stream',
});

// Require stream exists
await eventStore.appendToStream('existing-stream', [event], {
  expectedStreamVersion: 'stream_exists',
});
```

### aggregateStream

Rebuilds state from events using an evolve function.

```typescript
interface ShoppingCart {
  items: ProductItem[];
  status: 'Open' | 'Confirmed' | 'Cancelled';
}

const { state, currentStreamVersion } = await eventStore.aggregateStream<
  ShoppingCart,
  ShoppingCartEvent
>('shopping_cart-123', {
  evolve: (state, event) => {
    switch (event.type) {
      case 'ProductItemAdded':
        return { ...state, items: [...state.items, event.data] };
      case 'ShoppingCartConfirmed':
        return { ...state, status: 'Confirmed' };
      default:
        return state;
    }
  },
  initialState: () => ({ items: [], status: 'Open' }),
});
```

## Result Types

### ReadStreamResult

```typescript
type ReadStreamResult<EventType, MetadataType> = {
  events: ReadEvent<EventType, MetadataType>[];
  currentStreamVersion: bigint;
  streamExists: boolean;
};
```

### AppendToStreamResult

```typescript
type AppendToStreamResult = {
  nextExpectedStreamVersion: bigint;
  createdNewStream: boolean;
};

// Some stores include global position
type AppendToStreamResultWithGlobalPosition = AppendToStreamResult & {
  lastEventGlobalPosition: bigint;
};
```

### AggregateStreamResult

```typescript
type AggregateStreamResult<State> = {
  state: State;
  currentStreamVersion: bigint;
  streamExists: boolean;
};
```

## Expected Stream Version

Control concurrency with expected versions:

| Value                 | Meaning                         |
| --------------------- | ------------------------------- |
| `bigint` (e.g., `5n`) | Exact version required          |
| `'no_stream'`         | Stream must not exist           |
| `'stream_exists'`     | Stream must exist (any version) |

```typescript
import { ConcurrencyError } from '@event-driven-io/emmett';

try {
  await eventStore.appendToStream('cart-123', [event], {
    expectedStreamVersion: 5n,
  });
} catch (error) {
  if (error instanceof ConcurrencyError) {
    console.log(`Expected: ${error.expected}, Actual: ${error.actual}`);
    // Retry with fresh state
  }
}
```

## Event Store Implementations

Emmett provides multiple implementations:

| Implementation   | Package                              | Use Case    |
| ---------------- | ------------------------------------ | ----------- |
| **In-Memory**    | `@event-driven-io/emmett`            | Testing     |
| **PostgreSQL**   | `@event-driven-io/emmett-postgresql` | Production  |
| **EventStoreDB** | `@event-driven-io/emmett-esdb`       | Production  |
| **MongoDB**      | `@event-driven-io/emmett-mongodb`    | Production  |
| **SQLite**       | `@event-driven-io/emmett-sqlite`     | Development |

### In-Memory (Testing)

```typescript
import { getInMemoryEventStore } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();
```

### PostgreSQL

```typescript
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

const eventStore = getPostgreSQLEventStore(connectionString);
```

### EventStoreDB

```typescript
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';

const eventStore = getEventStoreDBEventStore(client);
```

## Session Factory

For transaction management:

```typescript
interface EventStoreSessionFactory<Store extends EventStore> {
  withSession<T>(
    callback: (session: EventStoreSession<Store>) => Promise<T>,
  ): Promise<T>;
}

// Usage
await sessionFactory.withSession(async (session) => {
  await session.eventStore.appendToStream('stream-1', [event1]);
  await session.eventStore.appendToStream('stream-2', [event2]);
  // Both appends are part of the same transaction
});
```

## Hooks

Configure behavior after commits:

```typescript
const eventStore = getPostgreSQLEventStore(connectionString, {
  hooks: {
    onAfterCommit: async ({ events, streamName }) => {
      // Called after successful append
      // Warning: May not be called if process crashes
      await notifyExternalSystem(events);
    },
  },
});
```

::: warning
`onAfterCommit` is called exactly once if append succeeds, but:

- If the hook fails, the append still succeeds
- If process crashes after commit but before hook, delivery is not retried
- Race conditions may cause ordering issues under high concurrency
  :::

## Best Practices

### 1. Use Meaningful Stream Names

```typescript
// ✅ Good: Type + ID pattern
const streamName = `shopping_cart-${cartId}`;
const streamName = `user-${userId}`;

// ❌ Bad: Just ID
const streamName = cartId;
```

### 2. Always Handle Concurrency

```typescript
// ✅ Good: Handle version conflicts
try {
  await eventStore.appendToStream(streamName, events, {
    expectedStreamVersion: currentVersion,
  });
} catch (error) {
  if (error instanceof ConcurrencyError) {
    // Reload and retry
  }
}

// ❌ Bad: Ignore concurrency
await eventStore.appendToStream(streamName, events);
```

### 3. Use aggregateStream for Commands

```typescript
// ✅ Good: Aggregate then decide
const { state } = await eventStore.aggregateStream(streamName, {
  evolve,
  initialState,
});
const newEvents = decide(command, state);
await eventStore.appendToStream(streamName, newEvents);
```

## Type Source

<<< @./../packages/emmett/src/eventStore/eventStore.ts#event-store

## See Also

- [Choosing an Event Store](/guides/choosing-event-store)
- [PostgreSQL Event Store](/event-stores/postgresql)
- [EventStoreDB](/event-stores/esdb)
- [Command Handler](/api-reference/commandhandler) - Uses event store internally
- [Let's build an Event Store in one hour!](https://event-driven.io/en/lets_build_event_store_in_one_hour/)
