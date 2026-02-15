---
documentationType: reference
outline: deep
---

# Command

Commands represent the intention to perform a business operation. They are requests directed at a specific handler.

## Overview

Commands differ from events in key ways:

| Aspect           | Command              | Event                |
| ---------------- | -------------------- | -------------------- |
| **Tense**        | Imperative (do this) | Past (this happened) |
| **Outcome**      | May be rejected      | Immutable fact       |
| **Naming**       | `AddProductItem`     | `ProductItemAdded`   |
| **Multiplicity** | Single handler       | Multiple subscribers |

Commands express intent. The handler decides whether to accept or reject the request.

## Type Definition

```typescript
type Command<
  CommandType extends string = string,
  CommandData extends DefaultRecord = DefaultRecord,
  CommandMetaData extends DefaultRecord | undefined = undefined,
> = Readonly<{
  type: CommandType;
  data: CommandData;
  metadata?: CommandMetaData | DefaultCommandMetadata;
  kind?: 'Command';
}>;

type DefaultCommandMetadata = { now: Date };
```

| Property   | Type         | Description                                         |
| ---------- | ------------ | --------------------------------------------------- |
| `type`     | `string`     | Unique command type name (e.g., `'AddProductItem'`) |
| `data`     | `object`     | Request payload (must be a record, not primitive)   |
| `metadata` | `object?`    | Infrastructure data (defaults to `{ now: Date }`)   |
| `kind`     | `'Command'?` | Discriminator for union types with Events           |

## Basic Usage

### Defining Command Types

<<< @/snippets/api/command.ts#command-type

### Union Types for Aggregates

Define all commands for an aggregate as a discriminated union:

```typescript
import type { Command } from '@event-driven-io/emmett';

type ShoppingCartCommand =
  | Command<
      'OpenShoppingCart',
      {
        cartId: string;
        clientId: string;
      }
    >
  | Command<
      'AddProductItem',
      {
        productId: string;
        quantity: number;
      }
    >
  | Command<
      'RemoveProductItem',
      {
        productId: string;
        quantity: number;
      }
    >
  | Command<'ConfirmShoppingCart', {}>
  | Command<'CancelShoppingCart', {}>;
```

### Creating Commands with Factory

Use the `command` factory function for runtime command creation:

```typescript
import { command } from '@event-driven-io/emmett';

const addProduct = command<AddProductItem>('AddProductItem', {
  productId: 'shoes-1',
  quantity: 2,
});
// Result: { type: 'AddProductItem', data: {...}, kind: 'Command' }

// With timestamp metadata (default)
const addProductWithTime = command<AddProductItem>(
  'AddProductItem',
  { productId: 'shoes-1', quantity: 2 },
  { now: new Date() },
);
```

## Commands with Custom Metadata

Metadata carries cross-cutting concerns:

```typescript
type UserCommandMetadata = {
  userId: string;
  correlationId: string;
  now: Date;
};

type AuthenticatedAddProductItem = Command<
  'AddProductItem',
  { productId: string; quantity: number },
  UserCommandMetadata
>;

const authenticatedCommand = command<AuthenticatedAddProductItem>(
  'AddProductItem',
  { productId: 'shoes-1', quantity: 2 },
  { userId: 'user-123', correlationId: 'req-456', now: new Date() },
);
```

## Commands vs Events

Commands and events work together in the Decider pattern:

```typescript
// Command: Request to add a product
type AddProductItem = Command<
  'AddProductItem',
  {
    productId: string;
    quantity: number;
  }
>;

// Event: Result of successful command
type ProductItemAdded = Event<
  'ProductItemAdded',
  {
    productId: string;
    quantity: number;
    price: number; // Enriched during handling
  }
>;

// Decider decides command → events
const decide = (
  command: AddProductItem,
  state: ShoppingCart,
): ProductItemAdded[] => {
  if (state.status !== 'Open') {
    throw new IllegalStateError('Cart is not open');
  }

  return [
    {
      type: 'ProductItemAdded',
      data: {
        productId: command.data.productId,
        quantity: command.data.quantity,
        price: lookupPrice(command.data.productId),
      },
    },
  ];
};
```

## Utility Types

### Extracting Command Properties

```typescript
import type {
  CommandTypeOf,
  CommandDataOf,
  CommandMetaDataOf,
} from '@event-driven-io/emmett';

type AddProductItem = Command<'AddProductItem', { productId: string }>;

type CmdType = CommandTypeOf<AddProductItem>; // 'AddProductItem'
type CmdData = CommandDataOf<AddProductItem>; // { productId: string }
type CmdMeta = CommandMetaDataOf<AddProductItem>; // undefined
```

### Any Command

For generic handlers:

```typescript
import type { AnyCommand } from '@event-driven-io/emmett';

function logCommand(command: AnyCommand): void {
  console.log(`Command: ${command.type}`, command.data);
}
```

## Command Handling Patterns

### Direct Handler

```typescript
import { CommandHandler } from '@event-driven-io/emmett';

const handle = CommandHandler(eventStore, {
  decide,
  evolve,
  initialState,
  mapToStreamId: (command) => `shopping_cart-${command.data.cartId}`,
});

await handle({
  type: 'AddProductItem',
  data: { cartId: 'cart-123', productId: 'shoes-1', quantity: 2 },
});
```

### With Expected Version (Optimistic Concurrency)

```typescript
await handle(
  {
    type: 'AddProductItem',
    data: { cartId: 'cart-123', productId: 'shoes-1', quantity: 2 },
  },
  { expectedStreamVersion: 5n },
);
```

## Best Practices

### 1. Use Imperative Names

Commands express intent:

```typescript
// ✅ Good: Imperative
type AddProductItem = Command<'AddProductItem', {...}>;
type ConfirmOrder = Command<'ConfirmOrder', {...}>;

// ❌ Bad: Past tense (these are events)
type ProductItemAdded = Command<'ProductItemAdded', {...}>;
```

### 2. Include Target Identity

Commands must identify their target:

```typescript
// ✅ Good: Clear target
type AddProductItem = Command<
  'AddProductItem',
  {
    cartId: string; // Target aggregate
    productId: string;
    quantity: number;
  }
>;

// ❌ Bad: Missing target
type AddProductItem = Command<
  'AddProductItem',
  {
    productId: string;
    quantity: number;
    // Which cart?
  }
>;
```

### 3. Keep Commands Focused

One intent per command:

```typescript
// ✅ Good: Single responsibility
type AddProductItem = Command<'AddProductItem', {...}>;
type ApplyDiscount = Command<'ApplyDiscount', {...}>;

// ❌ Bad: Multiple operations
type AddProductItemAndApplyDiscount = Command<'AddProductItemAndApplyDiscount', {...}>;
```

### 4. Validate at Boundaries

Validate command data before handling:

```typescript
const handle = async (request: Request) => {
  const data = await request.json();

  // Validate at boundary
  if (data.quantity <= 0) {
    throw new ValidationError('Quantity must be positive');
  }

  // Create command with valid data
  const cmd = command<AddProductItem>('AddProductItem', data);
  await handler(cmd);
};
```

## Type Source

<<< @./../packages/emmett/src/typing/command.ts

## See Also

- [Getting Started - Commands](/getting-started#commands)
- [Event](/api-reference/event) - Facts produced by commands
- [Command Handler](/api-reference/commandhandler) - Processing commands
- [Decider](/api-reference/decider) - Pattern combining commands and events
