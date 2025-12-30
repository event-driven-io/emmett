---
documentationType: how-to-guide
outline: deep
---

# Testing Patterns

Emmett provides comprehensive testing utilities for event-sourced applications. This guide covers unit testing, integration testing, and end-to-end testing strategies.

## Testing Philosophy

Event Sourcing enables a powerful testing pattern:

- **GIVEN** a set of events that have occurred
- **WHEN** a command is executed
- **THEN** specific events are produced (or errors thrown)

This pattern applies at every level: unit tests, integration tests, and E2E tests.

## Unit Testing with DeciderSpecification

The `DeciderSpecification` provides a BDD-style API for testing business logic in isolation.

### Basic Usage

```typescript
import { DeciderSpecification } from '@event-driven-io/emmett';
import { decide, evolve, initialState } from './shoppingCart';

describe('Shopping Cart', () => {
  const spec = DeciderSpecification.for({
    decide,
    evolve,
    initialState,
  });

  it('adds product to empty cart', () =>
    spec([]) // GIVEN: no prior events
      .when({
        type: 'AddProductItem',
        data: { productId: 'shoes-1', quantity: 2, price: 99.99 },
      })
      .then([
        {
          type: 'ProductItemAdded',
          data: { productId: 'shoes-1', quantity: 2, price: 99.99 },
        },
      ]));
});
```

### Testing with Prior Events

```typescript
it('confirms cart with items', () =>
  spec([
    // GIVEN: these events have occurred
    {
      type: 'ProductItemAdded',
      data: { productId: 'shoes-1', quantity: 1, price: 99.99 },
    },
  ])
    .when({
      type: 'ConfirmShoppingCart',
      data: { now: new Date('2024-01-15') },
    })
    .then([
      {
        type: 'ShoppingCartConfirmed',
        data: { confirmedAt: new Date('2024-01-15') },
      },
    ]));
```

### Testing Errors

```typescript
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
```

### Testing No-Op Scenarios

```typescript
it('ignores duplicate product removal', () =>
  spec([
    { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 1, price: 10 } },
    { type: 'ProductItemRemoved', data: { productId: 'p1' } },
  ])
    .when({
      type: 'RemoveProductItem',
      data: { productId: 'p1' },
    })
    .thenNothingHappened());
```

## Integration Testing with ApiSpecification

Test your API endpoints with in-memory event store for fast, isolated tests.

### Setup

```typescript
import { ApiSpecification } from '@event-driven-io/emmett-expressjs';
import { getInMemoryEventStore } from '@event-driven-io/emmett';
import { shoppingCartApi, getApplication } from './api';

describe('Shopping Cart API', () => {
  let given: ApiSpecification;

  beforeAll(() => {
    const eventStore = getInMemoryEventStore();

    given = ApiSpecification.for(() =>
      getApplication({
        apis: [
          shoppingCartApi(
            eventStore,
            () => Promise.resolve(100), // Mock price lookup
          ),
        ],
      }),
    );
  });
});
```

### Testing Endpoints

```typescript
import { existingStream, expectResponse, expectEvents } from '@event-driven-io/emmett-expressjs';

it('adds product item', () =>
  given(
    existingStream('shopping_cart-123', [
      // Cart already exists with one item
      {
        type: 'ProductItemAdded',
        data: { productId: 'p1', quantity: 1, price: 50 },
      },
    ]),
  )
    .when((request) =>
      request
        .post('/clients/client-1/shopping-carts/123/product-items')
        .send({ productId: 'shoes-1', quantity: 2 }),
    )
    .then([
      expectResponse(200),
      expectEvents('shopping_cart-123', [
        {
          type: 'ProductItemAdded',
          data: {
            productId: 'shoes-1',
            quantity: 2,
            price: 100, // From mock
          },
        },
      ]),
    ]));
```

### Testing Error Responses

```typescript
it('returns 404 for non-existent cart', () =>
  given() // No existing streams
    .when((request) =>
      request.get('/clients/client-1/shopping-carts/999'),
    )
    .then([expectResponse(404)]));

it('returns 409 for version conflict', () =>
  given(
    existingStream('shopping_cart-123', [
      { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 1, price: 50 } },
    ]),
  )
    .when((request) =>
      request
        .post('/clients/client-1/shopping-carts/123/product-items')
        .set('If-Match', '"0"') // Wrong version
        .send({ productId: 'p2', quantity: 1 }),
    )
    .then([expectResponse(412)])); // Precondition Failed
```

## E2E Testing with Real Database

Test against real infrastructure using TestContainers.

### PostgreSQL Setup

```typescript
import { ApiE2ESpecification } from '@event-driven-io/emmett-expressjs';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('Shopping Cart API (E2E)', () => {
  let postgres: StartedPostgreSqlContainer;
  let given: ApiE2ESpecification;

  beforeAll(async () => {
    // Start PostgreSQL container
    postgres = await new PostgreSqlContainer().start();

    const eventStore = getPostgreSQLEventStore(postgres.getConnectionUri());

    given = ApiE2ESpecification.for(() =>
      getApplication({
        apis: [shoppingCartApi(eventStore, getProductPrice)],
      }),
    );
  });

  afterAll(async () => {
    await eventStore.close();
    await postgres.stop();
  });
});
```

### E2E Test Examples

```typescript
it('completes full shopping flow', async () => {
  const clientId = 'client-123';
  const cartId = 'cart-456';

  // Add first item
  await given()
    .when((request) =>
      request
        .post(`/clients/${clientId}/shopping-carts/${cartId}/product-items`)
        .send({ productId: 'shoes-1', quantity: 2 }),
    )
    .then([expectResponse(200)]);

  // Add second item
  await given()
    .when((request) =>
      request
        .post(`/clients/${clientId}/shopping-carts/${cartId}/product-items`)
        .send({ productId: 'shirt-1', quantity: 1 }),
    )
    .then([expectResponse(200)]);

  // Confirm cart
  await given()
    .when((request) =>
      request.post(`/clients/${clientId}/shopping-carts/${cartId}/confirm`),
    )
    .then([expectResponse(200)]);

  // Verify final state
  await given()
    .when((request) =>
      request.get(`/clients/${clientId}/shopping-carts/${cartId}`),
    )
    .then([
      expectResponse(200, {
        body: {
          status: 'Confirmed',
          productItems: expect.arrayContaining([
            expect.objectContaining({ productId: 'shoes-1', quantity: 2 }),
            expect.objectContaining({ productId: 'shirt-1', quantity: 1 }),
          ]),
        },
      }),
    ]);
});
```

## Testing Projections

Test that events correctly update read models.

### PostgreSQL Projection Testing

```typescript
import { PostgreSQLProjectionSpec, expectPongoDocuments, eventsInStream, newEventsInStream } from '@event-driven-io/emmett-postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

describe('Shopping Cart Summary Projection', () => {
  let postgres: StartedPostgreSqlContainer;
  let given: PostgreSQLProjectionSpec<ShoppingCartEvent>;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer().start();

    given = PostgreSQLProjectionSpec.for({
      projection: shoppingCartSummaryProjection,
      connectionString: postgres.getConnectionUri(),
    });
  });

  it('creates summary on first product', () =>
    given([])
      .when([
        {
          type: 'ProductItemAdded',
          data: { productId: 'shoes', quantity: 2, price: 100 },
          metadata: { streamName: 'cart-123' },
        },
      ])
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartSummary>('shopping_cart_summary')
          .withId('cart-123')
          .toBeEqual({
            productItemsCount: 2,
            totalAmount: 200,
          }),
      ));

  it('updates summary on additional products', () =>
    given(
      eventsInStream('cart-123', [
        {
          type: 'ProductItemAdded',
          data: { productId: 'shoes', quantity: 2, price: 100 },
        },
      ]),
    )
      .when(
        newEventsInStream('cart-123', [
          {
            type: 'ProductItemAdded',
            data: { productId: 'shirt', quantity: 1, price: 50 },
          },
        ]),
      )
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartSummary>('shopping_cart_summary')
          .withId('cart-123')
          .toBeEqual({
            productItemsCount: 3,
            totalAmount: 250,
          }),
      ));

  it('removes document on cart confirmation', () =>
    given(
      eventsInStream('cart-123', [
        { type: 'ProductItemAdded', data: { productId: 'shoes', quantity: 1, price: 100 } },
      ]),
    )
      .when(
        newEventsInStream('cart-123', [
          { type: 'ShoppingCartConfirmed', data: { confirmedAt: new Date() } },
        ]),
      )
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartSummary>('shopping_cart_summary')
          .withId('cart-123')
          .notToExist(),
      ));
});
```

## Test Organization

### Recommended Structure

```
src/
├── domain/
│   ├── shoppingCart.ts          # Business logic
│   └── shoppingCart.spec.ts     # Unit tests
├── api/
│   ├── shoppingCartApi.ts       # API routes
│   └── shoppingCartApi.int.spec.ts  # Integration tests
├── projections/
│   ├── cartSummary.ts           # Projection logic
│   └── cartSummary.spec.ts      # Projection tests
└── e2e/
    └── shopping.e2e.spec.ts     # E2E tests
```

### Test Pyramid for Event Sourcing

```
        /\
       /  \     E2E Tests (few, slow, real infra)
      /----\
     /      \   Integration Tests (more, faster, mocked deps)
    /--------\
   /          \ Unit Tests (many, fast, pure functions)
  /------------\
```

## Best Practices

### 1. Test Business Logic First

```typescript
// ✅ Good: Focus on business rules
spec([{ type: 'ProductItemAdded', data: { productId: 'p1', quantity: 10, price: 5 } }])
  .when({ type: 'ConfirmShoppingCart', data: { now: new Date() } })
  .then([{ type: 'ShoppingCartConfirmed', data: expect.any(Object) }]);
```

### 2. Use Meaningful Test Data

```typescript
// ✅ Good: Clear, realistic data
const clientId = 'client-premium-123';
const expensiveProduct = { productId: 'luxury-watch', quantity: 1, price: 5000 };

// ❌ Bad: Meaningless data
const x = { productId: 'p1', quantity: 1, price: 1 };
```

### 3. Test Edge Cases

```typescript
describe('edge cases', () => {
  it('handles zero quantity', () => /* ... */);
  it('handles maximum quantity', () => /* ... */);
  it('handles concurrent modifications', () => /* ... */);
  it('handles network failures', () => /* ... */);
});
```

### 4. Isolate Tests

```typescript
// ✅ Good: Each test is independent
beforeEach(() => {
  cartId = `cart-${uuid()}`;
});

// ❌ Bad: Tests depend on each other
let cartId = 'shared-cart'; // Mutations leak between tests
```

## Further Reading

- [Testing Event Sourcing, Emmett edition](https://event-driven.io/en/testing_event_sourcing_emmett_edition/)
- [Getting Started - Testing Section](/getting-started#unit-testing)
- [Building Operable Software with TDD](https://www.youtube.com/watch?v=prLRI3VEVq4)

## See Also

- [Getting Started](/getting-started) - Full tutorial including testing
- [Projections Guide](/guides/projections) - Testing projections in detail
- [API Reference: DeciderSpecification](/api-reference/decider)
