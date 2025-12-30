# @event-driven-io/emmett-tests

Internal E2E test suite for Emmett event store implementations.

## Overview

This package contains shared test suites that verify event store implementations conform to Emmett's expected behavior. It's used internally by the Emmett project to ensure consistency across all event store backends.

> **Note:** This package is private and not published to npm. It's used only for internal testing.

## What It Tests

The test suite validates:

- **Stream aggregation** - Time travel and state reconstruction
- **Command handling** - Retry behavior and version conflicts
- **Optimistic concurrency** - Expected version checks
- **Event store operations** - Append, read, aggregate

## Test Structure

```
src/
├── eventStore/
│   ├── features.ts           # Shared test cases
│   ├── shoppingCart.domain.ts # Test domain (shopping cart)
│   ├── shoppingCart.feature  # Gherkin feature specs
│   ├── timeTravel.feature    # Time travel feature specs
│   ├── esdb/                 # EventStoreDB tests
│   ├── inMemory/             # In-memory tests
│   └── postgresql/           # PostgreSQL tests
└── cli/
    └── cli.e2e.spec.ts       # CLI tests
```

## Running Tests

```bash
# All tests
pnpm run test

# By category
pnpm run test:unit     # Unit tests
pnpm run test:int      # Integration tests
pnpm run test:e2e      # End-to-end tests

# Watch mode
pnpm run test:unit:watch
pnpm run test:int:watch
pnpm run test:e2e:watch
```

## Using the Test Suite

Event store implementations can use the shared test suite:

```typescript
import { testAggregateStream, testCommandHandling } from '@event-driven-io/emmett-tests';

describe('MyEventStore', () => {
  const eventStoreFactory = async () => {
    // Return your event store instance
    return getMyEventStore(connectionString);
  };

  // Run the standard test suite
  testAggregateStream(eventStoreFactory, {
    getInitialIndex: () => 0n,
    teardownHook: async () => {
      // Cleanup
    },
  });

  testCommandHandling(eventStoreFactory, {
    getInitialIndex: () => 0n,
  });
});
```

## Test Domain

Tests use a shopping cart domain with:

- `ProductItemAdded` event
- `DiscountApplied` event
- `AddProductItem` command
- State evolution with totals

## Dependencies

This package depends on all Emmett event store implementations for testing:

- `@event-driven-io/emmett` (core)
- `@event-driven-io/emmett-postgresql`
- `@event-driven-io/emmett-esdb`
- `@event-driven-io/emmett-sqlite`
- `@event-driven-io/emmett-testcontainers`

## See Also

- [Testing Patterns](/docs/guides/testing) - Testing documentation
- [Event Store API](/docs/api-reference/eventstore) - Event store interface
