# @event-driven-io/emmett-mongodb

MongoDB adapter for the Emmett event sourcing library, providing event store implementation with stream management, inline projections, and flexible storage strategies.

## Purpose

This package enables MongoDB as a persistence backend for event-sourced applications built with Emmett. It stores event streams as documents with support for atomic inline projections, multiple storage strategies, and optimistic concurrency control using BigInt stream positions.

## Key Concepts

- **Event Stream**: A document containing all events for a single aggregate, stored with metadata and optional projections
- **Stream Name**: Composite identifier in format `streamType:streamId` (e.g., `shopping_cart:abc-123`)
- **Inline Projections**: Read models stored alongside events in the same document, updated atomically during append
- **Storage Strategy**: Configurable collection organization (per stream type, single collection, or custom)
- **Collection Prefix**: All collections use the `emt:` prefix (e.g., `emt:shopping_cart`)

## Installation

```bash
npm install @event-driven-io/emmett-mongodb
# or
pnpm add @event-driven-io/emmett-mongodb
# or
yarn add @event-driven-io/emmett-mongodb
```

**Peer dependencies** (must be installed separately):

```bash
npm install @event-driven-io/emmett mongodb
```

## Quick Start

### Basic Event Store Setup

```typescript
import {
  getMongoDBEventStore,
  toStreamName,
} from '@event-driven-io/emmett-mongodb';
import { type Event, STREAM_DOES_NOT_EXIST } from '@event-driven-io/emmett';

// Define your events
type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: { productId: string; quantity: number; price: number } }
>;
type DiscountApplied = Event<
  'DiscountApplied',
  { percent: number; couponId: string }
>;
type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

// Create event store with connection string
const eventStore = getMongoDBEventStore({
  connectionString: 'mongodb://localhost:27017/mydb',
});

// Append events to a stream
const streamName = toStreamName('shopping_cart', 'cart-123');

await eventStore.appendToStream<ShoppingCartEvent>(
  streamName,
  [
    {
      type: 'ProductItemAdded',
      data: { productItem: { productId: 'prod-1', quantity: 2, price: 29.99 } },
    },
  ],
  { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
);

// Read events from stream
const { events, currentStreamVersion } =
  await eventStore.readStream(streamName);

// Close the event store when done (only needed when using connection string)
await eventStore.close();
```

### Using an Existing MongoClient

```typescript
import { MongoClient } from 'mongodb';
import { getMongoDBEventStore } from '@event-driven-io/emmett-mongodb';

const client = new MongoClient('mongodb://localhost:27017/mydb');
await client.connect();

// Client lifecycle is managed externally - no close() method on event store
const eventStore = getMongoDBEventStore({ client });
```

### Aggregating Stream State

```typescript
type ShoppingCart = {
  productItems: Array<{ productId: string; quantity: number; price: number }>;
  totalAmount: number;
};

const evolve = (
  state: ShoppingCart,
  event: ShoppingCartEvent,
): ShoppingCart => {
  switch (event.type) {
    case 'ProductItemAdded':
      return {
        productItems: [...state.productItems, event.data.productItem],
        totalAmount:
          state.totalAmount +
          event.data.productItem.price * event.data.productItem.quantity,
      };
    case 'DiscountApplied':
      return {
        ...state,
        totalAmount: state.totalAmount * (1 - event.data.percent / 100),
      };
  }
};

const { state, currentStreamVersion } = await eventStore.aggregateStream(
  streamName,
  {
    evolve,
    initialState: () => ({ productItems: [], totalAmount: 0 }),
  },
);
```

## How-to Guides

### Configure Storage Strategies

The MongoDB event store supports three storage strategies:

#### Collection Per Stream Type (Default, Recommended)

Each stream type gets its own collection, named `emt:{streamType}`:

```typescript
const eventStore = getMongoDBEventStore({
  connectionString: 'mongodb://localhost:27017/mydb',
  storage: 'COLLECTION_PER_STREAM_TYPE',
});
// shopping_cart streams -> emt:shopping_cart collection
// order streams -> emt:order collection
```

#### Single Collection

All streams stored in one collection:

```typescript
const eventStore = getMongoDBEventStore({
  connectionString: 'mongodb://localhost:27017/mydb',
  storage: {
    type: 'SINGLE_COLLECTION',
    collectionName: 'emt:all_events', // optional, defaults to 'emt:streams'
  },
});
```

#### Custom Resolution

Define your own collection mapping:

```typescript
const eventStore = getMongoDBEventStore({
  connectionString: 'mongodb://localhost:27017/mydb',
  storage: {
    type: 'CUSTOM',
    collectionFor: (streamType) => ({
      collectionName: `custom_${streamType}`,
      databaseName: 'events_db', // optional
    }),
  },
});
```

### Define Inline Projections

Inline projections are stored alongside events and updated atomically:

```typescript
import {
  mongoDBInlineProjection,
  getMongoDBEventStore,
} from '@event-driven-io/emmett-mongodb';
import { projections } from '@event-driven-io/emmett';

type ShoppingCartDetails = {
  productItems: Array<{ productId: string; quantity: number; price: number }>;
  totalAmount: number;
  itemCount: number;
};

const shoppingCartDetailsProjection = mongoDBInlineProjection<
  ShoppingCartDetails,
  ShoppingCartEvent
>({
  name: 'shopping_cart_details', // optional, defaults to '_default'
  schemaVersion: 1,
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
  evolve: (document, event) => {
    const doc = document ?? { productItems: [], totalAmount: 0, itemCount: 0 };

    switch (event.type) {
      case 'ProductItemAdded':
        return {
          productItems: [...doc.productItems, event.data.productItem],
          totalAmount:
            doc.totalAmount +
            event.data.productItem.price * event.data.productItem.quantity,
          itemCount: doc.itemCount + 1,
        };
      case 'DiscountApplied':
        return {
          ...doc,
          totalAmount: doc.totalAmount * (1 - event.data.percent / 100),
        };
    }
  },
});

const eventStore = getMongoDBEventStore({
  connectionString: 'mongodb://localhost:27017/mydb',
  projections: projections.inline([shoppingCartDetailsProjection]),
});
```

With an initial state:

```typescript
const projectionWithInitialState = mongoDBInlineProjection<
  ShoppingCartDetails,
  ShoppingCartEvent
>({
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
  initialState: () => ({ productItems: [], totalAmount: 0, itemCount: 0 }),
  evolve: (document, event) => {
    // document is never null here due to initialState
    switch (event.type) {
      case 'ProductItemAdded':
        return {
          productItems: [...document.productItems, event.data.productItem],
          totalAmount:
            document.totalAmount +
            event.data.productItem.price * event.data.productItem.quantity,
          itemCount: document.itemCount + 1,
        };
      case 'DiscountApplied':
        return {
          ...document,
          totalAmount: document.totalAmount * (1 - event.data.percent / 100),
        };
    }
  },
});
```

### Query Inline Projections

The event store provides helpers for querying inline projections:

```typescript
// Find a single projection by stream name
const details =
  await eventStore.projections.inline.findOne<ShoppingCartDetails>(
    { streamName: 'shopping_cart:cart-123' },
    { totalAmount: { $gt: 100 } }, // optional MongoDB filter
  );

// Find by stream type and ID
const details2 =
  await eventStore.projections.inline.findOne<ShoppingCartDetails>({
    streamType: 'shopping_cart',
    streamId: 'cart-123',
    projectionName: 'shopping_cart_details',
  });

// Find multiple projections
const allCarts = await eventStore.projections.inline.find<ShoppingCartDetails>(
  { streamType: 'shopping_cart' },
  { totalAmount: { $gt: 50 } },
  { skip: 0, limit: 10, sort: { totalAmount: -1 } },
);

// Count projections
const count = await eventStore.projections.inline.count<ShoppingCartDetails>(
  { streamType: 'shopping_cart' },
  { itemCount: { $gte: 5 } },
);
```

### Access Raw Collections

For advanced queries, access the underlying MongoDB collection:

```typescript
const collection =
  await eventStore.collectionFor<ShoppingCartEvent>('shopping_cart');

// Use standard MongoDB operations
const streams = await collection
  .find({ 'metadata.streamPosition': { $gt: 10n } })
  .toArray();
```

### Test Inline Projections

Use the BDD-style specification helpers:

```typescript
import {
  MongoDBInlineProjectionSpec,
  eventInStream,
  expectInlineReadModel,
} from '@event-driven-io/emmett-mongodb';

const given = MongoDBInlineProjectionSpec.for<
  `shopping_cart:${string}`,
  ShoppingCartEvent
>({
  projection: shoppingCartDetailsProjection,
  connectionString: 'mongodb://localhost:27017/testdb',
});

await given(
  eventInStream('shopping_cart:test-1', {
    type: 'ProductItemAdded',
    data: { productItem: { productId: 'p1', quantity: 1, price: 100 } },
  }),
)
  .when([
    { type: 'DiscountApplied', data: { percent: 10, couponId: 'SAVE10' } },
  ])
  .then(
    expectInlineReadModel
      .withName('shopping_cart_details')
      .toHave({ totalAmount: 90 }),
  );
```

## API Reference

### getMongoDBEventStore

Creates a MongoDB event store instance.

```typescript
function getMongoDBEventStore(
  options: MongoDBEventStoreOptions,
): MongoDBEventStore;
```

**Options:**

| Property           | Type                              | Description                                                          |
| ------------------ | --------------------------------- | -------------------------------------------------------------------- |
| `client`           | `MongoClient`                     | Existing MongoDB client (mutually exclusive with `connectionString`) |
| `connectionString` | `string`                          | MongoDB connection URI (mutually exclusive with `client`)            |
| `clientOptions`    | `MongoClientOptions`              | Options for MongoClient when using connection string                 |
| `projections`      | `ProjectionRegistration[]`        | Array of inline projection definitions                               |
| `storage`          | `MongoDBEventStoreStorageOptions` | Storage strategy configuration                                       |

### MongoDBEventStore

Extended EventStore interface with MongoDB-specific features:

| Method                                              | Description                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `readStream(streamName, options?)`                  | Read events from a stream                                           |
| `appendToStream(streamName, events, options?)`      | Append events to a stream                                           |
| `aggregateStream(streamName, options)`              | Fold events into aggregate state                                    |
| `collectionFor(streamType)`                         | Get raw MongoDB collection for a stream type                        |
| `projections.inline.findOne(filter, query?)`        | Find single inline projection                                       |
| `projections.inline.find(filter, query?, options?)` | Find multiple inline projections                                    |
| `projections.inline.count(filter, query?)`          | Count inline projections                                            |
| `close()`                                           | Close the MongoDB client (only when created with connection string) |

### Stream Naming Functions

| Function                                   | Description                                       |
| ------------------------------------------ | ------------------------------------------------- |
| `toStreamName(streamType, streamId)`       | Create stream name: `streamType:streamId`         |
| `fromStreamName(streamName)`               | Parse stream name into `{ streamType, streamId }` |
| `toStreamCollectionName(streamType)`       | Create collection name: `emt:streamType`          |
| `fromStreamCollectionName(collectionName)` | Parse collection name into `{ streamType }`       |

### mongoDBInlineProjection

Creates an inline projection definition.

```typescript
function mongoDBInlineProjection<Doc, EventType>(
  options: MongoDBInlineProjectionOptions<Doc, EventType>,
): MongoDBInlineProjectionDefinition;
```

**Options:**

| Property        | Type        | Description                                  |
| --------------- | ----------- | -------------------------------------------- |
| `name`          | `string`    | Projection name (default: `_default`)        |
| `schemaVersion` | `number`    | Schema version for migrations (default: `1`) |
| `canHandle`     | `string[]`  | Event types this projection handles          |
| `evolve`        | `Function`  | State evolution function                     |
| `initialState`  | `() => Doc` | Optional initial state factory               |

## Architecture

### Document Structure

Each event stream is stored as a single MongoDB document:

```typescript
interface EventStream {
  streamName: string; // e.g., "shopping_cart:abc-123"
  messages: ReadEvent[]; // Array of events with metadata
  metadata: {
    streamId: string;
    streamType: string;
    streamPosition: bigint; // Current version (BigInt)
    createdAt: Date;
    updatedAt: Date;
  };
  projections: {
    // Inline projections
    [projectionName: string]: MongoDBReadModel;
  };
}
```

### Read Model Structure

Inline projections include metadata for version tracking:

```typescript
interface MongoDBReadModel<Doc> {
  ...Doc;                          // Your projection fields
  _metadata: {
    streamId: string;
    name: string;                  // Projection name
    schemaVersion: number;
    streamPosition: bigint;        // Last processed event position
  };
}
```

### Optimistic Concurrency

The event store uses MongoDB's atomic update operations with version checking:

```typescript
await eventStore.appendToStream(
  streamName,
  events,
  { expectedStreamVersion: 5n }, // Fails if current version !== 5
);
```

Special version constants:

- `STREAM_DOES_NOT_EXIST` - Expect stream to not exist
- `STREAM_EXISTS` - Expect stream to exist (any version)
- `NO_CONCURRENCY_CHECK` - Skip version validation

## Dependencies

### Peer Dependencies

| Package                   | Version   | Purpose                          |
| ------------------------- | --------- | -------------------------------- |
| `@event-driven-io/emmett` | `0.38.3`  | Core event sourcing abstractions |
| `mongodb`                 | `^6.10.0` | MongoDB driver                   |

### Development Dependencies

| Package                                  | Purpose                  |
| ---------------------------------------- | ------------------------ |
| `@event-driven-io/emmett-testcontainers` | Test container utilities |
| `@testcontainers/mongodb`                | MongoDB testcontainer    |
