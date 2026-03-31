---
documentationType: how-to-guide
outline: deep
---

# Projections

::: warning
We created this page with the help of the GenAI tool.

We're currently double-checking it to ensure the information is 100% correct and free of hallucinations.
:::

Projections transform event streams into read models optimized for queries. This guide covers patterns, implementation, and best practices.

## Why Projections?

In Event Sourcing, rebuilding state from events works well for single entities. But queries like "show all shopping carts" would require reading thousands of streams and rebuilding each cart in memory.

**Projections solve this by:**

- Pre-computing query results as events occur
- Storing optimized read models in queryable formats
- Updating incrementally rather than recomputing

## Types of Projections

### Single-Stream Projections

One event stream maps to one document. The document ID equals the stream ID.

**Use when:** Your read model represents a single entity (shopping cart, order, user profile).

<<< ./projections/singleStreamProjection.snippet.ts#single-stream-projection

### Multi-Stream Projections

Events from multiple streams combine into documents with custom IDs.

**Use when:** Your read model aggregates across entities (customer analytics, product statistics, dashboards) or multiple streams of the same type.

<<< ./projections/multiStreamProjection.snippet.ts#multi-stream-projection{11,15}

## Inline vs Async Projections

### Inline Projections

Execute within the same transaction as the event append.

**Pros:**

- Strong consistency - read model is always up to date with events,
- No eventual consistency delays,
- Simpler mental model.

**Cons:**

- Slower appends (projection runs synchronously adding additonal operations during append),
- Multi-stream projection can override their data in high contention scenarios,
- Can't project to external systems.

<<< ./projections/projectionSetup.snippet.ts#inline-projection-setup

### Async Projections

Process events in background process. We recommend to run multi-stream projections asynchronously.

**Pros:**

- Faster appends (no overhead for updating read models),
- Can project to external systems,
- Better scalability,
- Enable batching of operations,
- Multi-stream projection won't override their data in high contention scenarios,

**Cons:**

- Eventual consistency,
- Require stateful service running async projections,

<<< ./projections/projectionSetup.snippet.ts#async-projection-setup

## Projection Patterns

### Initial State Pattern

Provide a default state instead of handling null:

<<< ./projections/multiStreamProjection.snippet.ts#projection-with-default

This pattern works both for single and multi stream projections.

### Deletion Pattern

Return `null` from the `evolve` function to delete the document:

<<< ./projections/projectionPatterns.snippet.ts#deletion-pattern{18-20}

### Selective Handling

Use the `canHandle` option to filter which events reach your `evolve` function. Events not listed in `canHandle` are ignored by the projection. See the `canHandle` usage in both [single-stream](#single-stream-projections) and [multi-stream](#multi-stream-projections) projections above.

### Metadata Usage

Access event metadata for cross-stream correlation through the `getDocumentId` and `evolve` functions. The [multi-stream projection](#multi-stream-projections) example above shows how `event.metadata.clientId` determines which document to update.

## Querying Read Models

### With Pongo (PostgreSQL)

Projected read models are stored in Pongo collections. Query them using the `PongoDb` instance:

<<< ./projections/queryingReadModels.snippet.ts#querying-read-models

### In API Routes

Use read model query functions in your Express route handlers:

<<< ./projections/queryingReadModels.snippet.ts#api-routes

## Testing Projections

Use the `PostgreSQLProjectionSpec` for BDD-style tests with the `given`/`when`/`then` pattern:

<<< ./projections/testingProjections.snippet.ts#testing-projection

## Best Practices

### 1. Keep Projections Focused

```typescript
// ✅ Good: Single responsibility
const cartSummaryProjection = /* totals only */;
const cartDetailsProjection = /* full item list */;
const cartStatusProjection = /* status tracking */;

// ❌ Bad: Kitchen sink projection
const cartEverythingProjection = /* all data combined */;
```

### 2. Design for Queries

```typescript
// ✅ Good: Matches query patterns
interface ProductSalesReport {
  productId: string;
  totalQuantitySold: number;
  totalRevenue: number;
  lastSoldAt: Date;
}

// Query: "Show me best-selling products"
await productSales.find({}).sort({ totalQuantitySold: -1 }).limit(10);
```

### 3. Handle Missing Documents

Use the [Initial State Pattern](#initial-state-pattern) to provide a default state, or handle the `null` case explicitly in `evolve` as shown in the [single-stream projection](#single-stream-projections) example above.

### 4. Version Your Projections

When projection logic changes, you may need to rebuild:

```typescript
const projection = pongoSingleStreamProjection({
  collectionName: 'cart_summaries_v2', // Version in name
  // ... new logic
});
```

### 5. Consider Rebuild Strategy

For production changes:

1. Deploy new projection alongside old
2. Rebuild from event history
3. Switch reads to new projection
4. Remove old projection

## Troubleshooting

### Projection Not Updating

1. Check `canHandle` includes the event type
2. Verify event metadata has required fields
3. Check for errors in `evolve` function
4. Confirm projection is registered with event store

### Inconsistent State

1. Inline projections: Check transaction boundaries
2. Async projections: Check checkpoint progress
3. Look for duplicate event processing

### Performance Issues

1. Reduce events handled per projection
2. Use async projections for complex logic
3. Add indexes to read model collections
4. Consider batching in async projectors

## Further Reading

- [Writing and testing event-driven projections](https://event-driven.io/en/emmett_projections_testing/)
- [Using event metadata in projections](https://event-driven.io/en/projections_and_event_metadata/)
- [Getting Started - Read Models](/getting-started#read-models)

## See Also

- [Testing Patterns](/guides/testing) - Testing projections in detail
- [PostgreSQL Event Store](/event-stores/postgresql) - Pongo projections
- [API Reference: Projections](/api-reference/projections)
