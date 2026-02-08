# @event-driven-io/emmett-esdb

EventStoreDB adapter for the Emmett event sourcing library, providing event store operations and subscription-based consumers with built-in retry logic.

## Purpose

This package connects Emmett to [EventStoreDB](https://www.eventstore.com/), enabling you to persist events to EventStoreDB streams and consume them using subscription-based processors. It handles the translation between Emmett's event sourcing abstractions and EventStoreDB's native client, including optimistic concurrency control, global position tracking, and resilient subscription management.

## Key Concepts

- **EventStoreDBEventStore**: Extended EventStore interface that returns global positions on append operations and provides consumer factory methods
- **Consumer**: Background processor that subscribes to EventStoreDB streams and routes events to reactors or projectors
- **Reactor**: Message handler for side effects (sending emails, calling APIs, triggering workflows)
- **Projector**: Message handler that builds read models from events
- **$all subscription**: Subscribe to all events across all streams in EventStoreDB
- **Stream subscription**: Subscribe to events in a specific stream or category
- **Checkpoint**: Position tracking for resumable subscriptions (uses stream revision or global position)

## Installation

```bash
npm install @event-driven-io/emmett-esdb @event-driven-io/emmett @eventstore/db-client
```

Both `@event-driven-io/emmett` and `@eventstore/db-client` are peer dependencies and must be installed alongside this package.

## Quick Start

### Creating an Event Store

```typescript
import { EventStoreDBClient } from '@eventstore/db-client';
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';

// Connect to EventStoreDB
const client = EventStoreDBClient.connectionString(
  'esdb://localhost:2113?tls=false',
);

// Create the Emmett event store adapter
const eventStore = getEventStoreDBEventStore(client);
```

### Appending Events

```typescript
import type { Event } from '@event-driven-io/emmett';

// Define your event types
type GuestCheckedIn = Event<
  'GuestCheckedIn',
  { guestId: string; roomNumber: string }
>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;
type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;

// Append events to a stream
const guestId = 'guest-123';
const streamName = `guestStay-${guestId}`;

const result = await eventStore.appendToStream<GuestStayEvent>(streamName, [
  { type: 'GuestCheckedIn', data: { guestId, roomNumber: '101' } },
]);

console.log('Stream version:', result.nextExpectedStreamVersion);
console.log('Global position:', result.lastEventGlobalPosition);
```

### Reading Events

```typescript
// Read all events from a stream
const { events, currentStreamVersion } =
  await eventStore.readStream<GuestStayEvent>(streamName);

// Aggregate stream state using a reducer
const { state, currentStreamVersion } = await eventStore.aggregateStream<
  GuestState,
  GuestStayEvent
>(streamName, {
  evolve: (state, event) => {
    switch (event.type) {
      case 'GuestCheckedIn':
        return {
          ...state,
          status: 'checked-in',
          roomNumber: event.data.roomNumber,
        };
      case 'GuestCheckedOut':
        return { ...state, status: 'checked-out' };
      default:
        return state;
    }
  },
  initialState: () => ({ status: 'unknown', roomNumber: undefined }),
});
```

### Subscribing to Events with a Reactor

```typescript
import {
  $all,
  eventStoreDBEventStoreConsumer,
} from '@event-driven-io/emmett-esdb';

// Create a consumer that subscribes to all events
const consumer = eventStoreDBEventStoreConsumer({
  connectionString: 'esdb://localhost:2113?tls=false',
  from: { stream: $all },
});

// Add a reactor for handling events
consumer.reactor<GuestStayEvent>({
  processorId: 'guest-notifications',
  eachMessage: async (event) => {
    if (event.type === 'GuestCheckedIn') {
      console.log(
        `Guest ${event.data.guestId} checked into room ${event.data.roomNumber}`,
      );
      // Send welcome email, update availability, etc.
    }
  },
});

// Start consuming
await consumer.start();

// Later, stop gracefully
await consumer.close();
```

### Building Read Models with a Projector

```typescript
import {
  inMemoryProjector,
  inMemorySingleStreamProjection,
  getInMemoryDatabase,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { eventStoreDBEventStoreConsumer } from '@event-driven-io/emmett-esdb';

// Define your read model
type GuestStaySummary = {
  _id?: string;
  guestId: string;
  status: 'checked-in' | 'checked-out';
  roomNumber?: string;
};

// Create the projection
const guestStaySummaryProjection = inMemorySingleStreamProjection<
  GuestStayEvent,
  GuestStaySummary
>({
  collectionName: 'guestStaySummaries',
  canHandle: ['GuestCheckedIn', 'GuestCheckedOut'],
  evolve: (document, event: ReadEvent<GuestStayEvent>) => {
    switch (event.type) {
      case 'GuestCheckedIn':
        return {
          ...document,
          guestId: event.data.guestId,
          status: 'checked-in',
          roomNumber: event.data.roomNumber,
        };
      case 'GuestCheckedOut':
        return { ...document, status: 'checked-out' };
      default:
        return document;
    }
  },
  initialState: () => ({
    guestId: '',
    status: 'checked-out',
  }),
});

// Set up the in-memory database and projector
const database = getInMemoryDatabase();

const projector = inMemoryProjector<GuestStayEvent>({
  processorId: 'guest-summary-projector',
  projection: guestStaySummaryProjection,
  connectionOptions: { database },
});

// Create consumer with the projector
const consumer = eventStoreDBEventStoreConsumer<GuestStayEvent>({
  connectionString: 'esdb://localhost:2113?tls=false',
  processors: [projector],
});

await consumer.start();
```

## How-to Guides

### Subscribe to a Specific Stream

```typescript
const consumer = eventStoreDBEventStoreConsumer({
  connectionString: 'esdb://localhost:2113?tls=false',
  from: { stream: 'guestStay-guest-123' },
});
```

### Subscribe to a Category Stream

EventStoreDB supports category projections with the `$ce-` prefix:

```typescript
const consumer = eventStoreDBEventStoreConsumer({
  connectionString: 'esdb://localhost:2113?tls=false',
  from: {
    stream: '$ce-guestStay',
    options: { resolveLinkTos: true },
  },
});
```

### Resume from a Checkpoint

```typescript
consumer.reactor<GuestStayEvent>({
  processorId: 'my-processor',
  startFrom: { lastCheckpoint: 1000n }, // Resume from global position 1000
  eachMessage: async (event) => {
    // Handle event
  },
});
```

### Start from Current Position

Use `'CURRENT'` to start from where the processor last stopped (requires checkpoint storage):

```typescript
consumer.reactor<GuestStayEvent>({
  processorId: 'my-processor',
  startFrom: 'CURRENT',
  connectionOptions: { database }, // In-memory database for checkpoint storage
  eachMessage: async (event) => {
    // Handle event
  },
});
```

### Configure Retry Options

```typescript
import type { AsyncRetryOptions } from '@event-driven-io/emmett';

const consumer = eventStoreDBEventStoreConsumer({
  connectionString: 'esdb://localhost:2113?tls=false',
  resilience: {
    resubscribeOptions: {
      forever: true,
      minTimeout: 100,
      factor: 1.5,
    } satisfies AsyncRetryOptions,
  },
});
```

### Use with Optimistic Concurrency

```typescript
import { STREAM_DOES_NOT_EXIST, STREAM_EXISTS } from '@event-driven-io/emmett';

// Expect stream to not exist (first event)
await eventStore.appendToStream(streamName, events, {
  expectedStreamVersion: STREAM_DOES_NOT_EXIST,
});

// Expect specific version
await eventStore.appendToStream(streamName, events, {
  expectedStreamVersion: 5n,
});

// Expect stream to exist (any version)
await eventStore.appendToStream(streamName, events, {
  expectedStreamVersion: STREAM_EXISTS,
});
```

### Stop Processing After a Condition

```typescript
consumer.reactor<GuestStayEvent>({
  processorId: 'my-processor',
  stopAfter: (event) => event.metadata.globalPosition >= targetPosition,
  eachMessage: async (event) => {
    // Handle event
  },
});
```

## API Reference

### getEventStoreDBEventStore

```typescript
function getEventStoreDBEventStore(
  client: EventStoreDBClient,
): EventStoreDBEventStore;
```

Creates an Emmett event store adapter from an EventStoreDB client.

### EventStoreDBEventStore

Extended `EventStore` interface with:

| Method                                         | Description                                  |
| ---------------------------------------------- | -------------------------------------------- |
| `appendToStream(streamName, events, options?)` | Append events and return global position     |
| `readStream(streamName, options?)`             | Read events from a stream                    |
| `aggregateStream(streamName, options)`         | Aggregate stream state using evolve function |
| `consumer(options?)`                           | Create a subscription-based consumer         |

### eventStoreDBEventStoreConsumer

```typescript
function eventStoreDBEventStoreConsumer<MessageType>(
  options: EventStoreDBEventStoreConsumerOptions<MessageType>,
): EventStoreDBEventStoreConsumer<MessageType>;
```

**Options:**

| Property                        | Type                                 | Description                                        |
| ------------------------------- | ------------------------------------ | -------------------------------------------------- |
| `connectionString`              | `string`                             | EventStoreDB connection string                     |
| `client`                        | `EventStoreDBClient`                 | Alternative: provide client directly               |
| `from`                          | `EventStoreDBEventStoreConsumerType` | Stream to subscribe to (`$all` or specific stream) |
| `processors`                    | `MessageProcessor[]`                 | Pre-configured processors                          |
| `pulling.batchSize`             | `number`                             | Messages per batch (default: 100)                  |
| `resilience.resubscribeOptions` | `AsyncRetryOptions`                  | Retry configuration                                |

**Consumer Methods:**

| Method               | Description                  |
| -------------------- | ---------------------------- |
| `reactor(options)`   | Create a reactor processor   |
| `projector(options)` | Create a projector processor |
| `start()`            | Start consuming events       |
| `stop()`             | Stop consuming (can restart) |
| `close()`            | Stop and clean up resources  |

### EventStoreDBReadEventMetadata

Metadata included with each read event:

| Property         | Type     | Description                |
| ---------------- | -------- | -------------------------- |
| `eventId`        | `string` | Unique event identifier    |
| `streamName`     | `string` | Source stream name         |
| `streamPosition` | `bigint` | Position within the stream |
| `globalPosition` | `bigint` | Position in the global log |
| `checkpoint`     | `bigint` | Position for resumption    |

### Subscription Start Options

| Value                        | Description                              |
| ---------------------------- | ---------------------------------------- |
| `'BEGINNING'`                | Start from the first event               |
| `'END'`                      | Start from current end (new events only) |
| `'CURRENT'`                  | Resume from last stored checkpoint       |
| `{ lastCheckpoint: bigint }` | Resume from specific position            |

## Architecture

```
+------------------+     +------------------------+     +------------------+
|   Your Code      | --> | EventStoreDBEventStore | --> | EventStoreDB     |
+------------------+     +------------------------+     +------------------+
                                   |
                                   v
                         +------------------+
                         |    Consumer      |
                         +------------------+
                                   |
                    +--------------+--------------+
                    |                             |
                    v                             v
           +----------------+            +----------------+
           |    Reactor     |            |   Projector    |
           | (Side Effects) |            | (Read Models)  |
           +----------------+            +----------------+
```

**Data Flow:**

1. Events are appended to EventStoreDB through the event store adapter
2. The consumer subscribes to `$all` or specific streams
3. Events flow through Node.js Transform streams for backpressure handling
4. Reactors and projectors process events sequentially
5. Checkpoints are stored for resumable processing

**Retry Behavior:**

The adapter includes built-in retry logic for database unavailability (gRPC error code 14). Default retry options:

- Retries forever
- Minimum timeout: 100ms
- Exponential backoff factor: 1.5

## Dependencies

### Peer Dependencies

- `@event-driven-io/emmett` - Core Emmett library
- `@eventstore/db-client` (^6.2.1) - Official EventStoreDB JavaScript client

### Internal Dependencies

- Node.js `stream` module for Transform/Writable stream handling
- `uuid` for generating consumer IDs
