---
documentationType: how-to-guide
outline: deep
---

# Error Handling

Emmett provides a structured approach to error handling with built-in error types and HTTP Problem Details support.

## Built-in Error Types

Emmett includes several error types that map to common scenarios:

| Error Type | HTTP Status | Use Case |
|------------|-------------|----------|
| `ValidationError` | 400 | Invalid input data |
| `IllegalStateError` | 403 | Business rule violation |
| `NotFoundError` | 404 | Resource doesn't exist |
| `ConcurrencyError` | 412 | Version conflict |

### ValidationError

Use when request data fails validation:

```typescript
import { ValidationError } from '@event-driven-io/emmett';

const addProduct = (command: AddProductItem, state: ShoppingCart) => {
  if (command.data.quantity <= 0) {
    throw new ValidationError('Quantity must be positive');
  }

  if (command.data.price < 0) {
    throw new ValidationError('Price cannot be negative');
  }

  // Process valid command...
};
```

### IllegalStateError

Use when an operation violates business rules:

```typescript
import { IllegalStateError } from '@event-driven-io/emmett';

const confirmCart = (command: ConfirmCart, state: ShoppingCart) => {
  if (state.status === 'Confirmed') {
    throw new IllegalStateError('Cart is already confirmed');
  }

  if (state.status === 'Cancelled') {
    throw new IllegalStateError('Cannot confirm a cancelled cart');
  }

  if (state.items.length === 0) {
    throw new IllegalStateError('Cannot confirm an empty cart');
  }

  return { type: 'ShoppingCartConfirmed', data: { confirmedAt: new Date() } };
};
```

### NotFoundError

Use when a requested resource doesn't exist:

```typescript
import { NotFoundError } from '@event-driven-io/emmett';

const getCart = async (cartId: string) => {
  const result = await eventStore.readStream(`shopping_cart-${cartId}`);

  if (result.events.length === 0) {
    throw new NotFoundError(`Shopping cart ${cartId} not found`);
  }

  return rebuildState(result.events);
};
```

### ConcurrencyError

Thrown automatically by event stores on version conflicts, but you can also throw manually:

```typescript
import { ConcurrencyError } from '@event-driven-io/emmett';

const updateCart = async (cartId: string, expectedVersion: bigint) => {
  const { currentStreamVersion } = await eventStore.readStream(streamName);

  if (currentStreamVersion !== expectedVersion) {
    throw new ConcurrencyError(
      currentStreamVersion,
      expectedVersion,
    );
  }
};
```

## Problem Details (RFC 9457)

Emmett's Express.js integration automatically converts errors to [Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html) format:

```json
{
  "type": "about:blank",
  "title": "Illegal State",
  "status": 403,
  "detail": "Cannot confirm an empty cart"
}
```

### Default Error Mapping

The `getApplication` function sets up automatic error-to-status mapping:

```typescript
import { getApplication } from '@event-driven-io/emmett-expressjs';

const app = getApplication({
  apis: [shoppingCartApi],
});

// Errors automatically map to HTTP statuses:
// ValidationError → 400
// IllegalStateError → 403
// NotFoundError → 404
// ConcurrencyError → 412
```

### Custom Error Mapping

Add your own error types with custom mappings:

```typescript
import { getApplication, problemDetails } from '@event-driven-io/emmett-expressjs';

class InsufficientFundsError extends Error {
  constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super(`Insufficient funds: need ${required}, have ${available}`);
  }
}

const app = getApplication({
  apis: [shoppingCartApi],
  problemDetails: {
    mapError: (error) => {
      if (error instanceof InsufficientFundsError) {
        return {
          status: 402, // Payment Required
          title: 'Insufficient Funds',
          detail: error.message,
          required: error.required,
          available: error.available,
        };
      }
      return undefined; // Use default mapping
    },
  },
});
```

## Error Handling in Routes

### Using Response Helpers

```typescript
import { on, ok, notFound, badRequest, forbidden } from '@event-driven-io/emmett-expressjs';

router.get('/carts/:cartId', on(async (request) => {
  const cartId = request.params.cartId;

  if (!cartId) {
    return badRequest({ detail: 'Cart ID is required' });
  }

  const cart = await getCart(cartId);

  if (!cart) {
    return notFound({ detail: `Cart ${cartId} not found` });
  }

  if (cart.status === 'Private') {
    return forbidden({ detail: 'Access denied' });
  }

  return ok(cart);
}));
```

### Available Response Helpers

| Helper | Status | Use Case |
|--------|--------|----------|
| `ok(body)` | 200 | Successful response |
| `created(body, location)` | 201 | Resource created |
| `noContent()` | 204 | Success, no body |
| `badRequest(problem)` | 400 | Invalid request |
| `forbidden(problem)` | 403 | Not allowed |
| `notFound(problem)` | 404 | Not found |
| `conflict(problem)` | 409 | State conflict |
| `preconditionFailed(problem)` | 412 | Version mismatch |

### Throwing vs Returning

Both approaches work. Choose based on context:

```typescript
// Throwing - cleaner for deep business logic
const decide = (command, state) => {
  if (state.status === 'Closed') {
    throw new IllegalStateError('Cart is closed');
  }
  // ...
};

// Returning - cleaner for HTTP layer
router.get('/carts/:id', on(async (request) => {
  const cart = await findCart(request.params.id);
  if (!cart) {
    return notFound({ detail: 'Cart not found' });
  }
  return ok(cart);
}));
```

## Optimistic Concurrency

### Using ETags

Express.js integration supports ETag-based concurrency:

```typescript
// Client sends: If-Match: "5"
router.post('/carts/:cartId/confirm', on(async (request) => {
  const cartId = request.params.cartId;
  const expectedVersion = getExpectedVersionFromRequest(request);

  await handle(cartId, {
    type: 'ConfirmShoppingCart',
    data: { confirmedAt: new Date() },
  }, { expectedStreamVersion: expectedVersion });

  // Returns ETag: "6" in response
  return ok({ status: 'Confirmed' });
}));
```

### Handling Version Conflicts

```typescript
try {
  await eventStore.appendToStream(
    streamName,
    events,
    { expectedStreamVersion: 5n },
  );
} catch (error) {
  if (error instanceof ConcurrencyError) {
    // Handle conflict - maybe retry with fresh state
    console.log(`Expected ${error.expected}, but was ${error.actual}`);
  }
  throw error;
}
```

## Testing Error Scenarios

### Unit Tests

```typescript
import { DeciderSpecification } from '@event-driven-io/emmett';

describe('Shopping Cart Errors', () => {
  const spec = DeciderSpecification.for(shoppingCartDecider);

  it('rejects adding to confirmed cart', () =>
    spec([
      { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 1, price: 10 } },
      { type: 'ShoppingCartConfirmed', data: { confirmedAt: new Date() } },
    ])
      .when({
        type: 'AddProductItem',
        data: { productId: 'p2', quantity: 1, price: 20 },
      })
      .thenThrows(IllegalStateError));

  it('rejects negative quantity', () =>
    spec([])
      .when({
        type: 'AddProductItem',
        data: { productId: 'p1', quantity: -1, price: 10 },
      })
      .thenThrows(ValidationError));
});
```

### Integration Tests

```typescript
import { expectResponse } from '@event-driven-io/emmett-expressjs';

it('returns 404 for missing cart', () =>
  given()
    .when((request) => request.get('/carts/nonexistent'))
    .then([expectResponse(404)]));

it('returns 412 for version conflict', () =>
  given(existingStream('cart-123', [someEvent]))
    .when((request) =>
      request
        .post('/carts/123/items')
        .set('If-Match', '"999"') // Wrong version
        .send({ productId: 'p1', quantity: 1 }),
    )
    .then([expectResponse(412)]));
```

## Best Practices

### 1. Be Specific with Error Messages

```typescript
// ✅ Good: Specific, actionable
throw new ValidationError(
  `Quantity must be between 1 and 100, got ${quantity}`
);

// ❌ Bad: Vague
throw new ValidationError('Invalid quantity');
```

### 2. Use Appropriate Error Types

```typescript
// ✅ Good: Correct type for scenario
if (!product) throw new NotFoundError(`Product ${id} not found`);
if (cart.isClosed) throw new IllegalStateError('Cart is closed');
if (quantity < 0) throw new ValidationError('Quantity must be positive');

// ❌ Bad: Wrong type
throw new Error('Something went wrong'); // Too generic
```

### 3. Don't Expose Internal Details

```typescript
// ✅ Good: Safe for clients
return badRequest({ detail: 'Invalid product ID format' });

// ❌ Bad: Exposes internals
return badRequest({ detail: `SQL Error: ${sqlError.message}` });
```

### 4. Log Errors Appropriately

```typescript
router.post('/carts/:id/items', on(async (request) => {
  try {
    await handle(/* ... */);
    return ok({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      // Don't log validation errors - they're expected
      throw error;
    }

    // Log unexpected errors
    console.error('Unexpected error:', error);
    throw error;
  }
}));
```

## See Also

- [Express.js Integration](/frameworks/expressjs) - Full HTTP error handling
- [Testing Patterns](/guides/testing) - Testing error scenarios
- [API Reference: Event Store](/api-reference/eventstore) - Concurrency errors
