---
documentationType: reference
outline: deep
---

# Event

Events are immutable records of facts that have happened in your system. They are the foundation of Event Sourcing.

## Overview

In Event Sourcing, events serve dual purposes:
1. **Historical record** - What happened in your business process
2. **State source** - Events are replayed to rebuild current state

Events are immutable facts. Once recorded, they cannot be changed or deleted.

## Type Definition

```typescript
type Event<
  EventType extends string = string,
  EventData extends DefaultRecord = DefaultRecord,
  EventMetaData extends DefaultRecord | undefined = undefined,
> = Readonly<{
  type: EventType;
  data: EventData;
  metadata?: EventMetaData;
  kind?: 'Event';
}>;
```

| Property | Type | Description |
|----------|------|-------------|
| `type` | `string` | Unique event type name (e.g., `'ProductItemAdded'`) |
| `data` | `object` | Business data payload (must be a record, not primitive) |
| `metadata` | `object?` | Optional infrastructure data (user ID, tenant, timestamps) |
| `kind` | `'Event'?` | Discriminator for union types with Commands |

## Basic Usage

### Defining Event Types

<<< @/snippets/api/event.ts#event-type

### Union Types for Aggregates

Define all events for an aggregate as a discriminated union:

```typescript
import type { Event } from '@event-driven-io/emmett';

type ShoppingCartEvent =
  | Event<'ShoppingCartOpened', {
      cartId: string;
      clientId: string;
      openedAt: Date;
    }>
  | Event<'ProductItemAdded', {
      productId: string;
      quantity: number;
      price: number;
    }>
  | Event<'ProductItemRemoved', {
      productId: string;
      quantity: number;
    }>
  | Event<'ShoppingCartConfirmed', {
      confirmedAt: Date;
    }>
  | Event<'ShoppingCartCancelled', {
      cancelledAt: Date;
    }>;
```

### Creating Events with Factory

Use the `event` factory function for runtime event creation:

```typescript
import { event } from '@event-driven-io/emmett';

const added = event<ProductItemAdded>(
  'ProductItemAdded',
  { productId: 'shoes-1', quantity: 2, price: 99.99 }
);
// Result: { type: 'ProductItemAdded', data: {...}, kind: 'Event' }
```

## Events with Metadata

Metadata carries cross-cutting concerns like user identity or tracing:

```typescript
type AuditMetadata = {
  userId: string;
  correlationId: string;
  timestamp: Date;
};

type AuditedProductItemAdded = Event<
  'ProductItemAdded',
  { productId: string; quantity: number; price: number },
  AuditMetadata
>;

const auditedEvent = event<AuditedProductItemAdded>(
  'ProductItemAdded',
  { productId: 'shoes-1', quantity: 2, price: 99.99 },
  { userId: 'user-123', correlationId: 'req-456', timestamp: new Date() }
);
```

## Read Events

When events are read from the event store, they include additional metadata:

```typescript
type ReadEvent<
  EventType extends Event,
  MetadataType extends AnyRecordedMessageMetadata
> = {
  type: EventType['type'];
  data: EventType['data'];
  metadata: CombinedMetadata<EventType, MetadataType>;
};
```

### Stream Metadata

Events read from a stream include position information:

```typescript
type CommonReadEventMetadata = {
  streamName: string;      // Stream the event belongs to
  streamPosition: bigint;  // Position within the stream (0-indexed)
  createdAt: Date;         // When the event was recorded
};
```

### Global Position

Some event stores provide global ordering:

```typescript
type ReadEventMetadataWithGlobalPosition = CommonReadEventMetadata & {
  globalPosition: bigint;  // Position across all streams
};
```

## Utility Types

### Extracting Event Properties

```typescript
import type { EventTypeOf, EventDataOf, EventMetaDataOf } from '@event-driven-io/emmett';

type ProductItemAdded = Event<'ProductItemAdded', { productId: string }>;

type EventType = EventTypeOf<ProductItemAdded>;      // 'ProductItemAdded'
type EventData = EventDataOf<ProductItemAdded>;      // { productId: string }
type EventMeta = EventMetaDataOf<ProductItemAdded>;  // undefined
```

### Any Event

For generic handlers that accept any event:

```typescript
import type { AnyEvent } from '@event-driven-io/emmett';

function logEvent(event: AnyEvent): void {
  console.log(`Event: ${event.type}`, event.data);
}
```

## Best Practices

### 1. Use Past Tense Names

Events represent facts that have happened:

```typescript
// ✅ Good: Past tense
type ProductItemAdded = Event<'ProductItemAdded', {...}>;
type OrderShipped = Event<'OrderShipped', {...}>;

// ❌ Bad: Present/future tense
type AddProductItem = Event<'AddProductItem', {...}>;  // This is a command
```

### 2. Include Sufficient Context

Events should be self-contained:

```typescript
// ✅ Good: Contains all necessary data
type ProductItemAdded = Event<'ProductItemAdded', {
  productId: string;
  productName: string;  // Denormalized for projections
  quantity: number;
  unitPrice: number;
  totalPrice: number;   // Computed at event time
}>;

// ❌ Bad: Missing context
type ProductItemAdded = Event<'ProductItemAdded', {
  productId: string;  // Need to look up product details elsewhere
}>;
```

### 3. Avoid Optional Fields

Events are facts; they should be complete:

```typescript
// ✅ Good: Separate event types
type OrderShippedWithTracking = Event<'OrderShipped', {
  orderId: string;
  trackingNumber: string;
}>;

type OrderShippedNoTracking = Event<'OrderShippedNoTracking', {
  orderId: string;
}>;

// ❌ Bad: Optional fields blur meaning
type OrderShipped = Event<'OrderShipped', {
  orderId: string;
  trackingNumber?: string;  // When is it present?
}>;
```

### 4. Use Readonly Data

Events are immutable by design:

```typescript
// The Event type enforces Readonly automatically
type ProductItemAdded = Event<'ProductItemAdded', {
  productId: string;
  items: ProductItem[];  // Becomes readonly
}>;
```

## Type Source

<<< @./../packages/emmett/src/typing/event.ts

## See Also

- [Getting Started - Events](/getting-started#events)
- [Command](/api-reference/command) - Requests to change state
- [Decider](/api-reference/decider) - Pattern using events and commands
- [Projections](/guides/projections) - Building read models from events
