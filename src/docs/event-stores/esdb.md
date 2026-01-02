---
documentationType: reference
outline: deep
---

# EventStoreDB Event Store

EventStoreDB adapter for Emmett, providing native Event Sourcing capabilities with subscriptions, projections, and clustering support.

## Overview

EventStoreDB is purpose-built for Event Sourcing. The Emmett adapter provides:

- **Native subscriptions** - Catch-up and persistent subscriptions
- **Stream management** - Full EventStoreDB stream semantics
- **Resilience** - Built-in retry and recovery mechanisms
- **Server-side projections** - JavaScript projections on the server
- **Clustering** - High availability through EventStoreDB clusters

## Installation

```bash
npm install @event-driven-io/emmett-esdb
```

### Peer Dependencies

```bash
npm install @event-driven-io/emmett @eventstore/db-client
```

## Quick Start

### Basic Setup

```typescript
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import { EventStoreDBClient } from '@eventstore/db-client';

const client = EventStoreDBClient.connectionString(
  'esdb://localhost:2113?tls=false'
);

const eventStore = getEventStoreDBEventStore(client);
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
  ]
);
```

### Reading Events

```typescript
const { events, currentStreamVersion } = await eventStore.readStream(
  'ShoppingCart-123'
);

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

## Subscriptions

### Subscribing to a Stream

```typescript
const subscription = eventStore.subscribeToStream('ShoppingCart-123', {
  onEvent: async (event) => {
    console.log('Received:', event.type);
  },
  onError: (error) => {
    console.error('Subscription error:', error);
  },
});

// Later: stop subscription
await subscription.stop();
```

### Subscribing to All Events

```typescript
const subscription = eventStore.subscribeToAll({
  onEvent: async (event) => {
    console.log(`${event.metadata.streamName}: ${event.type}`);
  },
  fromPosition: 'start', // or specific position
});
```

### Category Subscriptions

Subscribe to all streams in a category (by prefix):

```typescript
// Subscribe to all shopping cart streams
const subscription = eventStore.subscribeToStream('$ce-ShoppingCart', {
  onEvent: async (event) => {
    // Handles events from ShoppingCart-123, ShoppingCart-456, etc.
  },
});
```

## Reactors and Projectors

### Using Reactors

React to events with side effects:

```typescript
import { esdbReactor } from '@event-driven-io/emmett-esdb';

const orderNotifications = esdbReactor({
  processorId: 'order-notifications',
  client,
  eachMessage: async (event, context) => {
    if (event.type === 'ShoppingCartConfirmed') {
      await sendConfirmationEmail(event.data);
    }
  },
  canHandle: ['ShoppingCartConfirmed'],
});

await orderNotifications.start();
```

### Using Projectors

Build read models from events:

```typescript
import { esdbProjector } from '@event-driven-io/emmett-esdb';

const cartSummaryProjector = esdbProjector({
  processorId: 'cart-summary',
  client,
  projection: {
    name: 'CartSummary',
    canHandle: ['ProductItemAdded', 'ProductItemRemoved'],
    handle: async (events, context) => {
      for (const event of events) {
        await updateCartSummary(event);
      }
    },
  },
});

await cartSummaryProjector.start();
```

## Checkpoint Management

Resume from where you left off:

```typescript
const subscription = eventStore.subscribeToAll({
  processorId: 'my-processor',
  onEvent: async (event, context) => {
    await processEvent(event);
    // Checkpoint is automatically saved
  },
  // Resume from last checkpoint
  fromPosition: 'lastCheckpoint',
});
```

## Retry and Resilience

Configure retry behavior:

```typescript
const reactor = esdbReactor({
  processorId: 'resilient-processor',
  client,
  eachMessage: async (event) => { /* ... */ },
  retryOptions: {
    retries: 5,
    minTimeout: 100,
    maxTimeout: 5000,
    factor: 2,
  },
  stopOnError: false, // Continue after errors
});
```

## Connection Options

```typescript
import { EventStoreDBClient } from '@eventstore/db-client';

// Connection string
const client = EventStoreDBClient.connectionString(
  'esdb://admin:changeit@localhost:2113?tls=false'
);

// Cluster connection
const clusterClient = EventStoreDBClient.connectionString(
  'esdb://node1:2113,node2:2113,node3:2113?tls=true'
);

// With explicit options
const client = new EventStoreDBClient(
  { endpoint: 'localhost:2113' },
  { insecure: true }
);
```

## Testing with TestContainers

```typescript
import { getEventStoreDBTestContainer } from '@event-driven-io/emmett-testcontainers';

describe('EventStoreDB Tests', () => {
  let container: StartedEventStoreDBContainer;
  let client: EventStoreDBClient;

  beforeAll(async () => {
    container = await getEventStoreDBTestContainer().start();
    client = container.getClient();
  });

  afterAll(async () => {
    await container.stop();
  });

  it('appends events', async () => {
    const eventStore = getEventStoreDBEventStore(client);
    // Test...
  });
});
```

## Stream Naming Conventions

EventStoreDB uses stream name prefixes for categories:

| Pattern | Purpose |
|---------|---------|
| `ShoppingCart-{id}` | Individual entity streams |
| `$ce-ShoppingCart` | Category projection (all carts) |
| `$et-ProductItemAdded` | Event type projection |

## Full Package Documentation

For complete API reference and advanced usage, see the [package README](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-esdb).

## See Also

- [Choosing an Event Store](/guides/choosing-event-store)
- [Testing with TestContainers](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-testcontainers)
- [EventStoreDB Documentation](https://developers.eventstore.com/)
