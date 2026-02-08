---
documentationType: reference
outline: deep
---

# Command Handler

The Command Handler encapsulates the standard Event Sourcing pattern: read state, run business logic, append events.

## Overview

Command handling follows a repeatable pattern:

1. **Aggregate stream** - Read events and build current state
2. **Execute business logic** - Run the handler with command and state
3. **Append events** - Store the resulting events with optimistic concurrency

```typescript
// The pattern Command Handler automates:
const { state, currentStreamVersion } = await eventStore.aggregateStream(
  streamName,
  { evolve, initialState },
);

const events = handle(command, state);

await eventStore.appendToStream(streamName, events, {
  expectedStreamVersion: currentStreamVersion,
});
```

## Basic Usage

### Creating a Command Handler

<<< @/snippets/gettingStarted/commandHandler.ts#command-handler

### Using the Handler

<<< @/snippets/gettingStarted/commandHandling.ts#command-handling

## Type Definitions

### CommandHandler

```typescript
const CommandHandler = <State, StreamEvent extends Event>(
  options: CommandHandlerOptions<State, StreamEvent>
) => async <Store extends EventStore>(
  store: Store,
  id: string,
  handle: CommandHandlerFunction<State, StreamEvent>,
  handleOptions?: HandleOptions<Store>
): Promise<CommandHandlerResult<State, StreamEvent, Store>>;
```

### CommandHandlerOptions

```typescript
type CommandHandlerOptions<State, StreamEvent extends Event> = {
  evolve: (state: State, event: StreamEvent) => State;
  initialState: () => State;
  mapToStreamId?: (id: string) => string;
  retry?: CommandHandlerRetryOptions;
};
```

| Property        | Type                         | Description                                |
| --------------- | ---------------------------- | ------------------------------------------ |
| `evolve`        | `(state, event) => state`    | State evolution function                   |
| `initialState`  | `() => State`                | Factory for initial state                  |
| `mapToStreamId` | `(id: string) => string`     | Maps ID to stream name (default: identity) |
| `retry`         | `CommandHandlerRetryOptions` | Retry configuration                        |

### CommandHandlerResult

```typescript
type CommandHandlerResult<State, StreamEvent, Store> = {
  newState: State;
  newEvents: StreamEvent[];
  nextExpectedStreamVersion: bigint;
  createdNewStream: boolean;
};
```

## Stream ID Mapping

Map business IDs to stream names:

```typescript
const handle = CommandHandler({
  evolve,
  initialState,
  mapToStreamId: (id) => `shopping_cart-${id}`,
});

// Called with business ID
await handle(eventStore, 'cart-123', (state) => [...]);
// Internally uses stream: 'shopping_cart-cart-123'
```

## Handler Functions

Handlers receive state and return events:

### Single Event

```typescript
await handle(eventStore, cartId, (state) => ({
  type: 'ProductItemAdded',
  data: { productId, quantity, price },
}));
```

### Multiple Events

```typescript
await handle(eventStore, cartId, (state) => [
  { type: 'DiscountApplied', data: { code: 'SAVE10' } },
  { type: 'TaxCalculated', data: { amount: 15.5 } },
]);
```

### Async Handler

```typescript
await handle(eventStore, cartId, async (state) => {
  const price = await lookupPrice(productId);
  return {
    type: 'ProductItemAdded',
    data: { productId, quantity, price },
  };
});
```

### Multiple Handlers (Sequential)

Execute multiple handlers in sequence, each seeing the updated state:

```typescript
await handle(eventStore, cartId, [
  (state) => ({ type: 'ProductItemAdded', data: productData }),
  (state) => {
    // state now includes the effect of ProductItemAdded
    if (state.items.length >= 3) {
      return { type: 'BulkDiscountApplied', data: { discount: 10 } };
    }
    return [];
  },
]);
```

## Optimistic Concurrency

### Automatic Version Tracking

By default, Command Handler tracks versions automatically:

```typescript
// First call: creates stream at version 0
await handle(eventStore, 'cart-123', (state) => firstEvent);

// Second call: expects version 0, appends at version 1
await handle(eventStore, 'cart-123', (state) => secondEvent);

// Concurrent call: fails if version changed
await handle(eventStore, 'cart-123', (state) => thirdEvent);
// Throws ConcurrencyError if stream was modified
```

### Explicit Version

```typescript
await handle(eventStore, cartId, (state) => events, {
  expectedStreamVersion: 5n,
});
```

### Require New Stream

```typescript
await handle(
  eventStore,
  cartId,
  (state) => [{ type: 'CartOpened', data: {} }],
  { expectedStreamVersion: 'no_stream' },
);
```

## Retry Configuration

### Retry on Version Conflict

```typescript
const handle = CommandHandler({
  evolve,
  initialState,
  retry: { onVersionConflict: true }, // 3 retries with backoff
});

// Or specify retry count
const handle = CommandHandler({
  evolve,
  initialState,
  retry: { onVersionConflict: 5 },
});
```

### Custom Retry Options

```typescript
const handle = CommandHandler({
  evolve,
  initialState,
  retry: {
    retries: 5,
    minTimeout: 100,
    factor: 2,
    shouldRetryError: (error) => error instanceof ConcurrencyError,
  },
});
```

### Per-Call Retry Override

```typescript
await handle(eventStore, cartId, (state) => events, {
  retry: { onVersionConflict: 10 },
});
```

## No-Op Handling

If handler returns empty array, no append occurs:

```typescript
await handle(eventStore, cartId, (state) => {
  // Already confirmed, do nothing
  if (state.status === 'Confirmed') {
    return [];
  }
  return [{ type: 'CartConfirmed', data: {} }];
});
```

## Error Handling

### Business Errors

Throw errors for business rule violations:

```typescript
await handle(eventStore, cartId, (state) => {
  if (state.status !== 'Open') {
    throw new IllegalStateError('Cart is not open');
  }

  if (command.quantity <= 0) {
    throw new ValidationError('Quantity must be positive');
  }

  return [{ type: 'ProductItemAdded', data: command }];
});
```

### Concurrency Errors

```typescript
import { ConcurrencyError } from '@event-driven-io/emmett';

try {
  await handle(eventStore, cartId, (state) => events);
} catch (error) {
  if (error instanceof ConcurrencyError) {
    // Stream was modified by another process
    console.log(
      `Version conflict: expected ${error.expected}, got ${error.actual}`,
    );
    // Retry with fresh state or notify user
  }
  throw error;
}
```

## Integration with Web Frameworks

### Express.js

```typescript
import { on, ok } from '@event-driven-io/emmett-expressjs';

router.post(
  '/carts/:id/items',
  on(async (request) => {
    const { id } = request.params;
    const { productId, quantity } = request.body;

    const result = await handle(eventStore, id, (state) => ({
      type: 'ProductItemAdded',
      data: { productId, quantity, price: await getPrice(productId) },
    }));

    return ok({
      status: 'Added',
      version: result.nextExpectedStreamVersion.toString(),
    });
  }),
);
```

### With ETag Concurrency

```typescript
router.post(
  '/carts/:id/confirm',
  on(async (request) => {
    const { id } = request.params;
    const expectedVersion = getExpectedVersionFromRequest(request);

    const result = await handle(
      eventStore,
      id,
      (state) => ({ type: 'CartConfirmed', data: { confirmedAt: new Date() } }),
      { expectedStreamVersion: expectedVersion },
    );

    return ok({ status: 'Confirmed' });
  }),
);
```

## Best Practices

### 1. Keep Handlers Pure When Possible

```typescript
// ✅ Good: Pure handler
await handle(eventStore, cartId, (state) => ({
  type: 'ProductItemAdded',
  data: { ...command.data, addedAt: command.metadata.now },
}));

// ⚠️ Less ideal: Side effects in handler
await handle(eventStore, cartId, async (state) => {
  await externalService.notify(); // Side effect
  return [event];
});
```

### 2. Validate Before Deciding

```typescript
// ✅ Good: Guard clauses first
await handle(eventStore, cartId, (state) => {
  if (state.status === 'Confirmed') {
    throw new IllegalStateError('Cannot modify confirmed cart');
  }
  return [event];
});
```

### 3. Use Type-Safe Event Unions

```typescript
// ✅ Good: Discriminated union of events
type ShoppingCartEvent =
  | Event<'ProductItemAdded', {...}>
  | Event<'CartConfirmed', {...}>;

const handle = CommandHandler<ShoppingCart, ShoppingCartEvent>({
  evolve,
  initialState,
});
```

## Type Source

<<< @./../packages/emmett/src/commandHandling/handleCommand.ts#command-handler

## See Also

- [Getting Started - Command Handling](/getting-started#command-handling)
- [Decider Pattern](/api-reference/decider)
- [Event Store](/api-reference/eventstore)
- [Error Handling](/guides/error-handling)
- [Optimistic Concurrency for Pessimistic Times](https://event-driven.io/en/optimistic_concurrency_for_pessimistic_times/)
