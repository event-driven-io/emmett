---
documentationType: reference
outline: deep
---

# Express.js Integration

Emmett's Express.js integration provides a streamlined way to build event-sourced web APIs with built-in error handling, ETag support, and testing utilities.

## Overview

The `@event-driven-io/emmett-expressjs` package provides:

- **Application setup helpers** - Sensible defaults for Express.js configuration
- **Request handlers** - Clean pattern for command handling in routes
- **Problem Details** - RFC 9457 compliant error responses
- **ETag support** - Optimistic concurrency via HTTP headers
- **Testing utilities** - BDD-style API testing

## Installation

```bash
npm install @event-driven-io/emmett-expressjs
```

### Peer Dependencies

```bash
npm install @event-driven-io/emmett express
npm install -D @types/express
```

## Quick Start

### Application Setup

```typescript
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import { getInMemoryEventStore } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();

const app = getApplication({
  apis: [shoppingCartApi(eventStore)],
});

startAPI(app, 3000);
```

### Defining Routes

```typescript
import { on, ok, created, notFound } from '@event-driven-io/emmett-expressjs';
import { Router } from 'express';

export const shoppingCartApi = (eventStore: EventStore) => (router: Router) => {
  const handle = CommandHandler(eventStore, shoppingCartDecider);

  // GET - Read shopping cart
  router.get(
    '/carts/:cartId',
    on(async (request) => {
      const cartId = request.params.cartId;

      const { state, currentStreamVersion } = await eventStore.aggregateStream(
        `shopping_cart-${cartId}`,
        { evolve, initialState },
      );

      if (currentStreamVersion === 0n) {
        return notFound({ detail: `Cart ${cartId} not found` });
      }

      return ok(state, { eTag: currentStreamVersion });
    }),
  );

  // POST - Add product item
  router.post(
    '/carts/:cartId/items',
    on(async (request) => {
      const cartId = request.params.cartId;
      const { productId, quantity } = request.body;

      const result = await handle(cartId, {
        type: 'AddProductItem',
        data: { productId, quantity, price: await getPrice(productId) },
      });

      return ok({ success: true }, { eTag: result.nextExpectedStreamVersion });
    }),
  );

  // POST - Confirm cart
  router.post(
    '/carts/:cartId/confirm',
    on(async (request) => {
      const cartId = request.params.cartId;

      await handle(cartId, {
        type: 'ConfirmShoppingCart',
        data: { confirmedAt: new Date() },
      });

      return ok({ status: 'Confirmed' });
    }),
  );
};
```

## Response Helpers

### Success Responses

```typescript
import { ok, created, noContent } from '@event-driven-io/emmett-expressjs';

// 200 OK with body
return ok({ items: cart.items });

// 200 OK with ETag
return ok(cart, { eTag: version });

// 201 Created with location header
return created({ id: cartId }, { location: `/carts/${cartId}` });

// 204 No Content
return noContent();
```

### Error Responses

```typescript
import {
  badRequest,
  notFound,
  forbidden,
  conflict,
  preconditionFailed,
} from '@event-driven-io/emmett-expressjs';

// 400 Bad Request
return badRequest({ detail: 'Quantity must be positive' });

// 404 Not Found
return notFound({ detail: 'Cart not found' });

// 403 Forbidden
return forbidden({ detail: 'Cart is already confirmed' });

// 409 Conflict
return conflict({ detail: 'Operation conflicts with current state' });

// 412 Precondition Failed (version mismatch)
return preconditionFailed({ detail: 'Cart was modified' });
```

## Problem Details (RFC 9457)

Errors are automatically formatted as Problem Details:

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "Cart cart-123 not found"
}
```

### Default Error Mapping

| Emmett Error        | HTTP Status |
| ------------------- | ----------- |
| `ValidationError`   | 400         |
| `IllegalStateError` | 403         |
| `NotFoundError`     | 404         |
| `ConcurrencyError`  | 412         |

### Custom Error Mapping

```typescript
const app = getApplication({
  apis: [shoppingCartApi],
  problemDetails: {
    mapError: (error) => {
      if (error instanceof InsufficientFundsError) {
        return {
          status: 402,
          title: 'Payment Required',
          detail: error.message,
        };
      }
      return undefined; // Use default mapping
    },
  },
});
```

## Optimistic Concurrency with ETags

### Reading Version

```typescript
router.get(
  '/carts/:cartId',
  on(async (request) => {
    const { state, currentStreamVersion } =
      await eventStore.aggregateStream(/*...*/);

    // Sets ETag header: ETag: "5"
    return ok(state, { eTag: currentStreamVersion });
  }),
);
```

### Checking Version on Write

```typescript
import { getExpectedVersionFromRequest } from '@event-driven-io/emmett-expressjs';

router.post(
  '/carts/:cartId/items',
  on(async (request) => {
    // Reads If-Match header: If-Match: "5"
    const expectedVersion = getExpectedVersionFromRequest(request);

    await eventStore.appendToStream(streamName, events, {
      expectedStreamVersion: expectedVersion,
    });

    return ok({ success: true });
  }),
);
```

## Testing

### Integration Tests (In-Memory)

```typescript
import {
  ApiSpecification,
  existingStream,
  expectResponse,
  expectEvents,
} from '@event-driven-io/emmett-expressjs';
import { getInMemoryEventStore } from '@event-driven-io/emmett';

describe('Shopping Cart API', () => {
  let given: ApiSpecification;

  beforeAll(() => {
    const eventStore = getInMemoryEventStore();

    given = ApiSpecification.for(() =>
      getApplication({
        apis: [shoppingCartApi(eventStore)],
      }),
    );
  });

  it('adds product to cart', () =>
    given(
      existingStream('shopping_cart-123', [
        {
          type: 'ProductItemAdded',
          data: { productId: 'p1', quantity: 1, price: 10 },
        },
      ]),
    )
      .when((request) =>
        request.post('/carts/123/items').send({ productId: 'p2', quantity: 2 }),
      )
      .then([
        expectResponse(200),
        expectEvents('shopping_cart-123', [
          {
            type: 'ProductItemAdded',
            data: { productId: 'p2', quantity: 2, price: expect.any(Number) },
          },
        ]),
      ]));

  it('returns 404 for missing cart', () =>
    given()
      .when((request) => request.get('/carts/nonexistent'))
      .then([expectResponse(404)]));
});
```

### E2E Tests (Real Database)

```typescript
import { ApiE2ESpecification } from '@event-driven-io/emmett-expressjs';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

describe('Shopping Cart API (E2E)', () => {
  let postgres: StartedPostgreSqlContainer;
  let given: ApiE2ESpecification;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer().start();
    const eventStore = getPostgreSQLEventStore(postgres.getConnectionUri());

    given = ApiE2ESpecification.for(() =>
      getApplication({
        apis: [shoppingCartApi(eventStore)],
      }),
    );
  });

  afterAll(async () => {
    await postgres.stop();
  });

  it('completes shopping flow', async () => {
    // Add item
    await given()
      .when((request) =>
        request
          .post('/carts/123/items')
          .send({ productId: 'shoes', quantity: 1 }),
      )
      .then([expectResponse(200)]);

    // Confirm
    await given()
      .when((request) => request.post('/carts/123/confirm'))
      .then([expectResponse(200)]);
  });
});
```

## Application Configuration

### Default Setup

`getApplication` provides sensible defaults:

```typescript
const app = getApplication({
  apis: [myApi],
});

// Includes:
// - JSON body parsing
// - URL encoding
// - Problem Details error handling
// - ETag support
```

### Custom Configuration

```typescript
import express from 'express';

const app = getApplication({
  apis: [myApi],

  // Add custom middleware
  beforeRoutes: (app) => {
    app.use(cors());
    app.use(helmet());
  },

  // Add after routes
  afterRoutes: (app) => {
    app.use(customErrorHandler);
  },

  // Customize problem details
  problemDetails: {
    mapError: customErrorMapper,
  },
});
```

### Using with Existing Express App

```typescript
import express from 'express';
import { setupRoutes } from '@event-driven-io/emmett-expressjs';

const app = express();

// Your existing middleware
app.use(cors());
app.use(express.json());

// Add Emmett routes
setupRoutes(app, [shoppingCartApi(eventStore)]);

app.listen(3000);
```

## WebAPI Setup Pattern

The recommended pattern for organizing routes:

```typescript
// api/shoppingCartApi.ts
import { WebApiSetup } from '@event-driven-io/emmett-expressjs';

export const shoppingCartApi =
  (
    eventStore: EventStore,
    getPrice: (productId: string) => Promise<number>,
  ): WebApiSetup =>
  (router) => {
    // All routes defined here
    router.get('/carts/:id' /* ... */);
    router.post('/carts/:id/items' /* ... */);
    router.post('/carts/:id/confirm' /* ... */);
  };

// main.ts
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';

const app = getApplication({
  apis: [
    shoppingCartApi(eventStore, priceService.getPrice),
    orderApi(eventStore),
    userApi(userService),
  ],
});

startAPI(app);
```

## Full Package Documentation

For complete API reference and advanced usage, see the [package README](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-expressjs).

## See Also

- [Getting Started](/getting-started) - Full tutorial with Express.js
- [Error Handling](/guides/error-handling) - Comprehensive error patterns
- [Testing Patterns](/guides/testing) - Testing strategies
- [Fastify Integration](/frameworks/fastify) - Alternative framework
