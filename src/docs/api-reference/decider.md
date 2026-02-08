---
documentationType: reference
outline: deep
---

# Decider

The Decider pattern is the core building block for event-sourced business logic. It separates business decisions from infrastructure concerns.

## Overview

A Decider consists of three pure functions:

| Function       | Purpose                                |
| -------------- | -------------------------------------- |
| `decide`       | Takes command + state, returns events  |
| `evolve`       | Takes state + event, returns new state |
| `initialState` | Returns the starting state             |

```typescript
type Decider<State, CommandType, EventType> = {
  decide: (command: CommandType, state: State) => EventType[];
  evolve: (state: State, event: EventType) => State;
  initialState: () => State;
};
```

## Type Definition

```typescript
import type { Command, Event } from '@event-driven-io/emmett';

type Decider<State, CommandType extends Command, StreamEvent extends Event> = {
  decide: (command: CommandType, state: State) => StreamEvent | StreamEvent[];
  evolve: (currentState: State, event: StreamEvent) => State;
  initialState: () => State;
};
```

## Building a Decider

### Step 1: Define State

```typescript
type ShoppingCart =
  | { status: 'Empty' }
  | {
      status: 'Open';
      items: ProductItem[];
    }
  | {
      status: 'Confirmed';
      items: ProductItem[];
      confirmedAt: Date;
    }
  | {
      status: 'Cancelled';
      cancelledAt: Date;
    };

const initialState = (): ShoppingCart => ({ status: 'Empty' });
```

### Step 2: Define Events

```typescript
type ShoppingCartEvent =
  | Event<'ShoppingCartOpened', { clientId: string; openedAt: Date }>
  | Event<
      'ProductItemAdded',
      { productId: string; quantity: number; price: number }
    >
  | Event<'ProductItemRemoved', { productId: string; quantity: number }>
  | Event<'ShoppingCartConfirmed', { confirmedAt: Date }>
  | Event<'ShoppingCartCancelled', { cancelledAt: Date }>;
```

### Step 3: Define Commands

```typescript
type ShoppingCartCommand =
  | Command<'OpenShoppingCart', { clientId: string }>
  | Command<
      'AddProductItem',
      { productId: string; quantity: number; price: number }
    >
  | Command<'RemoveProductItem', { productId: string; quantity: number }>
  | Command<'ConfirmShoppingCart', {}>
  | Command<'CancelShoppingCart', {}>;
```

### Step 4: Implement evolve

```typescript
const evolve = (
  state: ShoppingCart,
  event: ShoppingCartEvent,
): ShoppingCart => {
  switch (event.type) {
    case 'ShoppingCartOpened':
      return { status: 'Open', items: [] };

    case 'ProductItemAdded':
      if (state.status !== 'Open') return state;
      return {
        ...state,
        items: [
          ...state.items,
          {
            productId: event.data.productId,
            quantity: event.data.quantity,
            price: event.data.price,
          },
        ],
      };

    case 'ProductItemRemoved':
      if (state.status !== 'Open') return state;
      return {
        ...state,
        items: state.items.filter(
          (item) => item.productId !== event.data.productId,
        ),
      };

    case 'ShoppingCartConfirmed':
      if (state.status !== 'Open') return state;
      return {
        status: 'Confirmed',
        items: state.items,
        confirmedAt: event.data.confirmedAt,
      };

    case 'ShoppingCartCancelled':
      return {
        status: 'Cancelled',
        cancelledAt: event.data.cancelledAt,
      };

    default:
      return state;
  }
};
```

### Step 5: Implement decide

```typescript
import { IllegalStateError, ValidationError } from '@event-driven-io/emmett';

const decide = (
  command: ShoppingCartCommand,
  state: ShoppingCart,
): ShoppingCartEvent[] => {
  switch (command.type) {
    case 'OpenShoppingCart': {
      if (state.status !== 'Empty') {
        throw new IllegalStateError('Cart already exists');
      }
      return [
        {
          type: 'ShoppingCartOpened',
          data: {
            clientId: command.data.clientId,
            openedAt: command.metadata?.now ?? new Date(),
          },
        },
      ];
    }

    case 'AddProductItem': {
      if (state.status !== 'Open') {
        throw new IllegalStateError('Cart is not open');
      }
      if (command.data.quantity <= 0) {
        throw new ValidationError('Quantity must be positive');
      }
      return [
        {
          type: 'ProductItemAdded',
          data: command.data,
        },
      ];
    }

    case 'RemoveProductItem': {
      if (state.status !== 'Open') {
        throw new IllegalStateError('Cart is not open');
      }
      const item = state.items.find(
        (i) => i.productId === command.data.productId,
      );
      if (!item) {
        throw new IllegalStateError('Product not in cart');
      }
      return [
        {
          type: 'ProductItemRemoved',
          data: command.data,
        },
      ];
    }

    case 'ConfirmShoppingCart': {
      if (state.status !== 'Open') {
        throw new IllegalStateError('Cart is not open');
      }
      if (state.items.length === 0) {
        throw new IllegalStateError('Cannot confirm empty cart');
      }
      return [
        {
          type: 'ShoppingCartConfirmed',
          data: { confirmedAt: command.metadata?.now ?? new Date() },
        },
      ];
    }

    case 'CancelShoppingCart': {
      if (state.status === 'Confirmed') {
        throw new IllegalStateError('Cannot cancel confirmed cart');
      }
      if (state.status === 'Cancelled') {
        return []; // Already cancelled, no-op
      }
      return [
        {
          type: 'ShoppingCartCancelled',
          data: { cancelledAt: command.metadata?.now ?? new Date() },
        },
      ];
    }
  }
};
```

### Step 6: Compose the Decider

```typescript
const shoppingCartDecider: Decider<
  ShoppingCart,
  ShoppingCartCommand,
  ShoppingCartEvent
> = {
  decide,
  evolve,
  initialState,
};
```

## Using the Decider

### With Command Handler

```typescript
import { CommandHandler } from '@event-driven-io/emmett';

const handle = CommandHandler({
  ...shoppingCartDecider,
  mapToStreamId: (id) => `shopping_cart-${id}`,
});

await handle(eventStore, cartId, (state) =>
  decide({ type: 'AddProductItem', data: productData }, state),
);
```

### Direct Usage

```typescript
// Build state from events
const state = events.reduce(evolve, initialState());

// Make a decision
const newEvents = decide(command, state);

// Append to store
await eventStore.appendToStream(streamName, newEvents);
```

## Testing with DeciderSpecification

The `DeciderSpecification` provides BDD-style testing for deciders.

### Basic Usage

```typescript
import { DeciderSpecification } from '@event-driven-io/emmett';

const spec = DeciderSpecification.for(shoppingCartDecider);
```

### Testing Event Production

```typescript
describe('Shopping Cart', () => {
  const spec = DeciderSpecification.for(shoppingCartDecider);

  it('opens new cart', () =>
    spec([]) // GIVEN: no prior events
      .when({ type: 'OpenShoppingCart', data: { clientId: 'client-1' } })
      .then([
        {
          type: 'ShoppingCartOpened',
          data: expect.objectContaining({ clientId: 'client-1' }),
        },
      ]));

  it('adds product to open cart', () =>
    spec([
      {
        type: 'ShoppingCartOpened',
        data: { clientId: 'c1', openedAt: new Date() },
      },
    ])
      .when({
        type: 'AddProductItem',
        data: { productId: 'shoes', quantity: 2, price: 100 },
      })
      .then([
        {
          type: 'ProductItemAdded',
          data: { productId: 'shoes', quantity: 2, price: 100 },
        },
      ]));
});
```

### Testing Errors

```typescript
it('rejects adding to confirmed cart', () =>
  spec([
    {
      type: 'ShoppingCartOpened',
      data: { clientId: 'c1', openedAt: new Date() },
    },
    {
      type: 'ProductItemAdded',
      data: { productId: 'p1', quantity: 1, price: 10 },
    },
    { type: 'ShoppingCartConfirmed', data: { confirmedAt: new Date() } },
  ])
    .when({
      type: 'AddProductItem',
      data: { productId: 'p2', quantity: 1, price: 20 },
    })
    .thenThrows(IllegalStateError));

it('rejects with specific error message', () =>
  spec([])
    .when({
      type: 'AddProductItem',
      data: { productId: 'p1', quantity: -1, price: 10 },
    })
    .thenThrows(ValidationError, (e) => e.message.includes('positive')));
```

### Testing No-Op Scenarios

```typescript
it('ignores cancel on already cancelled cart', () =>
  spec([
    {
      type: 'ShoppingCartOpened',
      data: { clientId: 'c1', openedAt: new Date() },
    },
    { type: 'ShoppingCartCancelled', data: { cancelledAt: new Date() } },
  ])
    .when({ type: 'CancelShoppingCart', data: {} })
    .thenNothingHappened());
```

## Async Deciders

For deciders that need async operations (e.g., external lookups):

```typescript
const deciderWithPriceLookup = {
  decide: async (command: Command, state: State) => {
    if (command.type === 'AddProductItem') {
      const price = await priceService.lookup(command.data.productId);
      return [
        {
          type: 'ProductItemAdded',
          data: { ...command.data, price },
        },
      ];
    }
    // ...
  },
  evolve,
  initialState,
};

// AsyncDeciderSpecification works the same way
const spec = DeciderSpecification.for(deciderWithPriceLookup);

it('adds product with looked-up price', async () =>
  await spec([])
    .when({ type: 'AddProductItem', data: { productId: 'shoes', quantity: 1 } })
    .then([
      {
        type: 'ProductItemAdded',
        data: expect.objectContaining({ price: 99 }),
      },
    ]));
```

## Best Practices

### 1. Keep Deciders Pure

```typescript
// ✅ Good: Pure function, no side effects
const decide = (command, state) => {
  return [{ type: 'ProductItemAdded', data: command.data }];
};

// ❌ Bad: Side effects in decider
const decide = (command, state) => {
  logger.info('Adding product');  // Side effect
  database.update(command);        // Side effect
  return [...];
};
```

### 2. Use Discriminated Unions for State

```typescript
// ✅ Good: Clear state transitions
type Cart =
  | { status: 'Empty' }
  | { status: 'Open'; items: Item[] }
  | { status: 'Confirmed'; items: Item[]; confirmedAt: Date };

// ❌ Bad: Ambiguous state
type Cart = {
  items: Item[];
  isConfirmed: boolean;
  confirmedAt?: Date;
};
```

### 3. Validate in decide, Not evolve

```typescript
// ✅ Good: Validation in decide
const decide = (command, state) => {
  if (state.status !== 'Open') {
    throw new IllegalStateError('Cart not open');
  }
  return [event];
};

// evolve trusts events are valid
const evolve = (state, event) => {
  // No validation needed - event already happened
  return newState;
};
```

### 4. Return Empty Array for No-Op

```typescript
// ✅ Good: Explicit no-op
const decide = (command, state) => {
  if (state.status === 'Cancelled') {
    return []; // Already cancelled, nothing to do
  }
  return [cancelEvent];
};
```

## DeciderSpecification API

### given → when → then

```typescript
spec(givenEvents).when(command).then(expectedEvents);
```

### given → when → thenThrows

```typescript
// Check error type
spec(events).when(command).thenThrows(IllegalStateError);

// Check error with predicate
spec(events)
  .when(command)
  .thenThrows(IllegalStateError, (e) => e.message === 'Cart not open');

// Just check any error
spec(events).when(command).thenThrows();
```

### given → when → thenNothingHappened

```typescript
spec(events).when(command).thenNothingHappened();
```

## See Also

- [Getting Started - Business Logic](/getting-started#business-logic)
- [Command Handler](/api-reference/commandhandler) - Uses Decider internally
- [Testing Patterns](/guides/testing) - Comprehensive testing guide
- [Workflows](/guides/workflows) - Multi-aggregate coordination
