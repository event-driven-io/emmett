# @event-driven-io/emmett

Core event sourcing library for TypeScript providing event stores, command handling, projections, and testing utilities built around the Decider pattern.

## Purpose

Emmett provides the foundational abstractions for building event-sourced applications in TypeScript with strong typing and a clean, functional architecture.

**Without Emmett, you would have to:**

- Manually implement event store interfaces and version management
- Build your own optimistic concurrency control mechanisms
- Create custom command handling pipelines with retry logic
- Write projection infrastructure from scratch
- Develop testing utilities for event-sourced systems
- Handle the complexity of message processing and checkpointing

## Key Concepts

### The Decider Pattern

Emmett is built around the **Decider pattern**, which separates business logic into three pure functions:

```typescript
type Decider<State, CommandType, StreamEvent> = {
  // Determines what events occur when a command is applied to current state
  decide: (command: CommandType, state: State) => StreamEvent | StreamEvent[];

  // Evolves state based on an event (reducer/fold)
  evolve: (currentState: State, event: StreamEvent) => State;

  // Provides the starting state for a new aggregate
  initialState: () => State;
};
```

### Events and Commands

**Events** represent facts that have happened:

```typescript
type Event<EventType, EventData, EventMetaData> = {
  type: EventType;
  data: EventData;
  metadata?: EventMetaData;
};
```

**Commands** represent intentions to change state:

```typescript
type Command<CommandType, CommandData, CommandMetaData> = {
  type: CommandType;
  data: CommandData;
  metadata?: CommandMetaData;
};
```

### EventStore

The `EventStore` interface provides three core operations:

- `appendToStream` - Append events to a stream with optimistic concurrency
- `readStream` - Read events from a stream
- `aggregateStream` - Rebuild state by folding events with an evolve function

### Optimistic Concurrency

Emmett uses `ExpectedStreamVersion` for concurrency control:

- Specific version (bigint) - Must match exactly
- `STREAM_EXISTS` - Stream must have events
- `STREAM_DOES_NOT_EXIST` - Stream must be new
- `NO_CONCURRENCY_CHECK` - Skip version validation

## Installation

```bash
npm install @event-driven-io/emmett
# or
pnpm add @event-driven-io/emmett
# or
yarn add @event-driven-io/emmett
```

### Peer Dependencies

```bash
npm install uuid async-retry commander ts-node web-streams-polyfill
npm install -D @types/uuid @types/async-retry
```

## Quick Start

### Define Your Domain

```typescript
import {
  type Event,
  type Command,
  type Decider,
} from '@event-driven-io/emmett';

// Define your events
type ProductItemAdded = Event<
  'ProductItemAdded',
  { productId: string; quantity: number; price: number }
>;
type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { confirmedAt: Date }
>;

type ShoppingCartEvent = ProductItemAdded | ShoppingCartConfirmed;

// Define your commands
type AddProductItem = Command<
  'AddProductItem',
  { productId: string; quantity: number; price: number }
>;
type ConfirmShoppingCart = Command<'ConfirmShoppingCart', { now: Date }>;

type ShoppingCartCommand = AddProductItem | ConfirmShoppingCart;

// Define your state
type ShoppingCart = {
  status: 'opened' | 'confirmed';
  productItems: Array<{ productId: string; quantity: number; price: number }>;
};

// Create your decider
const shoppingCartDecider: Decider<
  ShoppingCart,
  ShoppingCartCommand,
  ShoppingCartEvent
> = {
  decide: (command, state): ShoppingCartEvent | ShoppingCartEvent[] => {
    switch (command.type) {
      case 'AddProductItem':
        return {
          type: 'ProductItemAdded',
          data: command.data,
        };
      case 'ConfirmShoppingCart':
        return {
          type: 'ShoppingCartConfirmed',
          data: { confirmedAt: command.data.now },
        };
    }
  },
  evolve: (state, event): ShoppingCart => {
    switch (event.type) {
      case 'ProductItemAdded':
        return {
          ...state,
          productItems: [...state.productItems, event.data],
        };
      case 'ShoppingCartConfirmed':
        return { ...state, status: 'confirmed' };
    }
  },
  initialState: () => ({ status: 'opened', productItems: [] }),
};
```

### Use the In-Memory Event Store

```typescript
import {
  getInMemoryEventStore,
  DeciderCommandHandler,
} from '@event-driven-io/emmett';

// Create an event store
const eventStore = getInMemoryEventStore();

// Create a command handler from your decider
const handle = DeciderCommandHandler({
  ...shoppingCartDecider,
  mapToStreamId: (id) => `shopping_cart-${id}`,
});

// Handle commands
const cartId = 'cart-123';

await handle(eventStore, cartId, {
  type: 'AddProductItem',
  data: { productId: 'shoes-1', quantity: 2, price: 99.99 },
});

await handle(eventStore, cartId, {
  type: 'ConfirmShoppingCart',
  data: { now: new Date() },
});

// Read the stream
const { events } = await eventStore.readStream(`shopping_cart-${cartId}`);
console.log(events); // All events for this cart
```

## How-to Guides

### Testing with DeciderSpecification

Use the BDD-style specification for testing your deciders:

```typescript
import { DeciderSpecification } from '@event-driven-io/emmett';

const spec = DeciderSpecification.for(shoppingCartDecider);

// Test: given events, when command, then expected events
spec([
  {
    type: 'ProductItemAdded',
    data: { productId: 'p1', quantity: 1, price: 10 },
  },
])
  .when({ type: 'ConfirmShoppingCart', data: { now: new Date() } })
  .then([
    { type: 'ShoppingCartConfirmed', data: { confirmedAt: expect.any(Date) } },
  ]);

// Test that nothing happens
spec([]).when(someCommand).thenNothingHappened();

// Test that an error is thrown
spec([]).when(invalidCommand).thenThrows(IllegalStateError);
```

### Creating Projections

Build read models from your events:

```typescript
import { projection, type ProjectionDefinition } from '@event-driven-io/emmett';

type ShoppingCartSummary = {
  id: string;
  itemCount: number;
  totalAmount: number;
};

const shoppingCartSummaryProjection: ProjectionDefinition<
  ShoppingCartEvent,
  any,
  { database: InMemoryDatabase }
> = projection({
  name: 'shopping-cart-summary',
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  handle: async (events, { database }) => {
    for (const event of events) {
      const cartId = event.metadata.streamName.split('-')[1];
      const collection =
        database.collection<ShoppingCartSummary>('cart-summaries');

      if (event.type === 'ProductItemAdded') {
        const existing = await collection.findOne({ id: cartId });
        await collection.updateOne(
          { id: cartId },
          {
            id: cartId,
            itemCount: (existing?.itemCount ?? 0) + event.data.quantity,
            totalAmount:
              (existing?.totalAmount ?? 0) +
              event.data.price * event.data.quantity,
          },
        );
      }
    }
  },
});
```

### Using the In-Memory Database

For projections and testing:

```typescript
import { getInMemoryDatabase } from '@event-driven-io/emmett';

const database = getInMemoryDatabase();
const users = database.collection<{ id: string; name: string }>('users');

// Insert
await users.insertOne({ id: '1', name: 'Alice' });

// Find
const user = await users.findOne({ id: '1' });

// Update with versioning
await users.updateOne(
  { id: '1' },
  { id: '1', name: 'Alice Smith' },
  { expectedVersion: 1n },
);
```

### Working with Message Bus

Publish and subscribe to events/commands:

```typescript
import { getInMemoryMessageBus } from '@event-driven-io/emmett';

const messageBus = getInMemoryMessageBus();

// Subscribe to events
messageBus.subscribe(
  async (event) => {
    console.log('Received:', event);
  },
  'ProductItemAdded',
  'ShoppingCartConfirmed'
);

// Handle commands (only one handler per command type)
messageBus.handle(
  async (command) => {
    // Process command
  },
  'AddProductItem'
);

// Publish events
await messageBus.publish({ type: 'ProductItemAdded', data: { ... } });

// Send commands
await messageBus.send({ type: 'AddProductItem', data: { ... } });
```

### Implementing Workflows (Sagas)

Coordinate operations across multiple aggregates:

```typescript
import { Workflow } from '@event-driven-io/emmett';

type OrderSagaInput = OrderPlaced | PaymentReceived | ShipmentCreated;
type OrderSagaOutput = RequestPayment | CreateShipment | CompleteOrder;

type OrderSagaState = {
  orderId: string | null;
  paymentReceived: boolean;
  shipped: boolean;
};

const orderWorkflow = Workflow<OrderSagaInput, OrderSagaState, OrderSagaOutput>(
  {
    name: 'order-fulfillment',
    initialState: () => ({
      orderId: null,
      paymentReceived: false,
      shipped: false,
    }),
    decide: (event, state) => {
      switch (event.type) {
        case 'OrderPlaced':
          return {
            type: 'RequestPayment',
            data: { orderId: event.data.orderId },
          };
        case 'PaymentReceived':
          return { type: 'CreateShipment', data: { orderId: state.orderId } };
        case 'ShipmentCreated':
          return { type: 'CompleteOrder', data: { orderId: state.orderId } };
      }
    },
    evolve: (state, event) => {
      switch (event.type) {
        case 'OrderPlaced':
          return { ...state, orderId: event.data.orderId };
        case 'PaymentReceived':
          return { ...state, paymentReceived: true };
        case 'ShipmentCreated':
          return { ...state, shipped: true };
        default:
          return state;
      }
    },
  },
);
```

## API Reference

### Core Exports

```typescript
// Event Store
export { EventStore, getInMemoryEventStore, InMemoryEventStore };
export { ReadStreamOptions, ReadStreamResult };
export { AggregateStreamOptions, AggregateStreamResult };
export { AppendToStreamOptions, AppendToStreamResult };
export { EventStoreSession, EventStoreSessionFactory };

// Expected Version
export {
  ExpectedStreamVersion,
  STREAM_EXISTS,
  STREAM_DOES_NOT_EXIST,
  NO_CONCURRENCY_CHECK,
  ExpectedVersionConflictError,
};

// Command Handling
export { CommandHandler, DeciderCommandHandler };
export { CommandHandlerOptions, HandleOptions };

// Types
export { Event, Command, Decider };
export { ReadEvent, ReadEventMetadata };
export { Message, RecordedMessage };
export { BigIntStreamPosition, BigIntGlobalPosition };

// Projections
export { ProjectionDefinition, projection };
export { inlineProjections, asyncProjections };

// Message Bus
export { MessageBus, CommandBus, EventBus };
export { getInMemoryMessageBus };

// Processors
export { MessageProcessor, reactor, projector };
export { Checkpointer, ReactorOptions, ProjectorOptions };

// Workflows
export { Workflow, WorkflowEvent, WorkflowCommand };

// Database
export { getInMemoryDatabase, InMemoryDatabase };
export { Document, WithId, WithVersion };

// Testing
export { DeciderSpecification, AsyncDeciderSpecification };
export { WrapEventStore, EventStoreWrapper };
export { assertTrue, assertEqual, assertDeepEqual, assertThrows };

// Utilities
export { asyncRetry, NoRetries };
export { JSONParser };
export { ValidationErrors };

// Errors
export { EmmettError, ConcurrencyError, ValidationError };
export { IllegalStateError, NotFoundError };
```

### EventStore Interface

```typescript
interface EventStore<ReadEventMetadataType> {
  // Aggregate events into state
  aggregateStream<State, EventType extends Event>(
    streamName: string,
    options: AggregateStreamOptions<State, EventType, ReadEventMetadataType>,
  ): Promise<AggregateStreamResult<State>>;

  // Read raw events from stream
  readStream<EventType extends Event>(
    streamName: string,
    options?: ReadStreamOptions,
  ): Promise<ReadStreamResult<EventType, ReadEventMetadataType>>;

  // Append events to stream
  appendToStream<EventType extends Event>(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions,
  ): Promise<AppendToStreamResult>;
}
```

### Decider Type

```typescript
type Decider<State, CommandType extends Command, StreamEvent extends Event> = {
  decide: (command: CommandType, state: State) => StreamEvent | StreamEvent[];
  evolve: (currentState: State, event: StreamEvent) => State;
  initialState: () => State;
};
```

### Projection Definition

```typescript
interface ProjectionDefinition<
  EventType,
  EventMetaDataType,
  ProjectionHandlerContext,
> {
  name?: string;
  canHandle: string[]; // Event types this projection handles
  handle: (
    events: ReadEvent<EventType, EventMetaDataType>[],
    context: ProjectionHandlerContext,
  ) => Promise<void>;
  truncate?: (context: ProjectionHandlerContext) => Promise<void>;
}
```

## Architecture

```
src/
├── index.ts                    # Main entry point, re-exports all modules
├── cli.ts                      # CLI entry point for emmett command
│
├── commandHandling/            # Command handler implementations
│   ├── handleCommand.ts        # Generic command handler with retry
│   └── handleCommandWithDecider.ts  # Decider-based command handler
│
├── eventStore/                 # Event store abstractions
│   ├── eventStore.ts           # Core EventStore interface
│   ├── inMemoryEventStore.ts   # In-memory implementation
│   ├── expectedVersion.ts      # Concurrency control
│   ├── afterCommit/            # Post-commit hooks
│   ├── projections/            # Inline projection handling
│   └── subscriptions/          # Streaming subscriptions
│
├── typing/                     # Core type definitions
│   ├── event.ts                # Event types
│   ├── command.ts              # Command types
│   ├── decider.ts              # Decider pattern type
│   └── message.ts              # Message abstractions
│
├── projections/                # Projection definitions
│   └── index.ts                # ProjectionDefinition, inline/async helpers
│
├── workflows/                  # Saga/workflow pattern
│   ├── workflow.ts             # Workflow type definition
│   └── workflowProcessor.ts    # Workflow processing
│
├── processors/                 # Message processors
│   ├── processors.ts           # MessageProcessor, reactor, projector
│   └── inMemoryProcessors.ts   # In-memory implementations
│
├── messageBus/                 # Message bus abstractions
│   └── index.ts                # MessageBus, CommandBus, EventBus
│
├── database/                   # Document database abstractions
│   ├── inMemoryDatabase.ts     # In-memory document store
│   └── types.ts                # Database types
│
├── testing/                    # Testing utilities
│   ├── deciderSpecification.ts # BDD-style decider testing
│   ├── assertions.ts           # Test assertions
│   └── wrapEventStore.ts       # Event store test wrapper
│
├── streaming/                  # Stream utilities
│   ├── collectors/             # Stream collectors (first, last, collect)
│   ├── decoders/               # Stream decoders
│   └── generators/             # Stream generators
│
├── serialization/              # Serialization utilities
│   └── json/                   # JSON parser with BigInt support
│
├── validation/                 # Validation utilities
│   └── index.ts                # Type validators, assertions
│
├── errors/                     # Error types
│   └── index.ts                # EmmettError, ConcurrencyError, etc.
│
├── utils/                      # General utilities
│   ├── retry.ts                # Async retry logic
│   ├── locking/                # Locking mechanisms
│   └── collections/            # Collection utilities
│
└── config/                     # Configuration
    └── plugins/                # CLI plugin system
```

## Dependencies

| Package                | Version | Purpose                               |
| ---------------------- | ------- | ------------------------------------- |
| `uuid`                 | ^10.0.0 | UUID generation for event/message IDs |
| `async-retry`          | ^1.3.3  | Retry logic for command handlers      |
| `commander`            | ^12.1.0 | CLI framework                         |
| `ts-node`              | ^10.9.2 | TypeScript execution for CLI          |
| `web-streams-polyfill` | ^4.0.0  | Web Streams API polyfill              |

## Related Packages

- **[@event-driven-io/emmett-postgresql](../emmett-postgresql)** - PostgreSQL event store adapter
- **[@event-driven-io/emmett-mongodb](../emmett-mongodb)** - MongoDB event store adapter
- **[@event-driven-io/emmett-esdb](../emmett-esdb)** - EventStoreDB adapter
- **[@event-driven-io/emmett-sqlite](../emmett-sqlite)** - SQLite event store adapter
- **[@event-driven-io/emmett-expressjs](../emmett-expressjs)** - Express.js integration
- **[@event-driven-io/emmett-fastify](../emmett-fastify)** - Fastify integration
