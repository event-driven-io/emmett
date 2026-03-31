---
documentationType: how-to-guide
outline: deep
---

# Read Models

In Event Sourcing, rebuilding state from events works well for a single entity (a shopping cart might have 10-50 events). But showing a list of all shopping carts? You'd need to read events from thousands of streams and rebuild each cart in memory on every page load.

Read models solve this. They are queryable representations of your data, stored in the database of your choice and shaped for specific questions your application needs to answer. A projection is the event handler that builds a read model. It takes events and transforms them into the stored result. Each projection is a different interpretation of the same facts: a shopping cart summary for the menu bar, a client analytics dashboard, a product sales report. Same events, different read models shaped for different questions.

This guide shows you how to build projections and query the read models they produce.

## Project Events into Read Models

### From a Single Stream

One event stream maps to one document. The document ID equals the stream ID.

**Use when:** your read model represents a single entity, like a shopping cart summary, an order status, or a user profile.

<<< ./projections/singleStreamProjection.snippet.ts#single-stream-projection

### From Multiple Streams

Events from multiple streams combine into documents with custom IDs.

**Use when:** your read model aggregates across entities, like a client's total spending across all their carts, product statistics from all orders, or system-wide dashboards.

<<< ./projections/multiStreamProjection.snippet.ts#multi-stream-projection{11,15}

## Choose Between Inline and Async Registration

### Inline Projections

Use inline when consistency matters more than write speed. Inline projections run in the same database transaction as the event append. Either both succeed or both fail, so your read model is always consistent with your events. For single-stream projections this is often the right default.

Be careful with inline multi-stream projections under high write load. When multiple streams update the same document concurrently, they can overwrite each other's changes. If that's a concern, switch to async.

<<< ./projections/projectionSetup.snippet.ts#inline-projection-setup

### Async Projections

Use async when you need faster appends, when you're projecting to external systems, or when you have multi-stream projections that would suffer from concurrent write conflicts. Async projections process events in a background process, decoupled from the append. The tradeoff is eventual consistency: your read model may lag behind by a short window.

<<< ./projections/projectionSetup.snippet.ts#async-projection-setup

## Common Patterns

### Provide a Default State

If you'd rather not deal with `null` in your `evolve` function, provide an `initialState`. Emmett will use it when the document doesn't exist yet:

<<< ./projections/multiStreamProjection.snippet.ts#projection-with-default

This works for both single-stream and multi-stream projections.

### Delete a Document from a Projection

Return `null` from `evolve` to delete the document. This is useful when a process completes and the read model should be cleared. For example, removing a pending cart summary after confirmation, so the next shopping session starts fresh:

<<< ./projections/projectionPatterns.snippet.ts#deletion-pattern{18-20}

### Filter Which Events Your Projection Handles

Your projection doesn't need to handle every event type in the stream. List the event types you care about in `canHandle`. Everything else is silently ignored. A shopping cart summary only needs product additions and removals; it doesn't need to know about confirmation or cancellation:

<<< ./projections/projectionOptions.snippet.ts#can-handle{3-10}

### Route Events Using Metadata

When building a multi-stream projection, you need a way to correlate events from different streams into the right document. If your read model groups data by client, but the client ID isn't in every event's data payload, you can pull it from event metadata. Be careful not to turn metadata into a bag for random data. Context like client ID, tenant, or correlation ID is a reasonable fit, especially if it's already available in your request pipeline for authorisation or routing:

<<< ./projections/projectionOptions.snippet.ts#metadata-usage{3-5}

## Query Read Models

### With Pongo (PostgreSQL)

Projected read models are stored in Pongo collections, PostgreSQL tables with a JSONB column for your document data. Query them using the Pongo client with MongoDB-like syntax:

<<< ./projections/queryingReadModels.snippet.ts#querying-read-models

### In API Routes

Wire Pongo queries into your Express route handlers to serve the read models:

<<< ./projections/queryingReadModels.snippet.ts#api-routes

## Test a Projection

Projection tests should run against a real database. Both querying behaviour and JSON serialisation can surprise you, so in-memory fakes won't give you enough confidence. Use `PostgreSQLProjectionSpec` with a test container for BDD-style given/when/then tests:

<<< ./projections/testingProjections.snippet.ts#testing-projection

## Best Practices

### 1. One Projection Per Query

A shopping cart summary for the menu bar only needs item count and total amount. It doesn't need the full product list or the cart status. If you need cart details for a different view, create a separate projection. The same events can feed multiple projections, each shaped for a different purpose. Multiple focused projections are easier to maintain and rebuild than one that tries to answer every question.

### 2. Shape Read Models for Queries

Start from the query your UI or API needs to serve, then shape your read model to match. If you're showing a "best-selling products" list, your read model should have fields you can sort and filter directly: total quantity sold, revenue, last sold date. Don't store raw event data and try to query it later; the whole point of a projection is to pre-shape data for the questions you'll ask.

### 3. Version Your Projections

When your projection logic changes (new fields, different calculations, a bug fix), existing documents were built with the old logic. You can't just update the code. Version the collection name and rebuild from events:

<<< ./projections/projectionOptions.snippet.ts#versioning{2}

### 4. Rebuild From Events

Events are your source of truth; read models are derived data you can always rebuild. For production changes without downtime, use a blue-green approach:

1. Deploy the new projection writing to a new collection alongside the old one
2. Let it catch up by processing the event history
3. Once it's current, switch your queries to the new collection
4. Remove the old projection

If you can afford a brief window of incomplete data, the simpler path is to truncate the old collection and replay all events through the updated projection logic.

## Troubleshooting

### Projection Not Updating

If your read model isn't reflecting new events, the most common cause is a missing event type in `canHandle`. The projection silently ignores any event type not listed there. For multi-stream projections, also verify that `getDocumentId` returns the correct ID. If it pulls from metadata, make sure the metadata is actually being set when events are appended.

### Stale Data in Multi-Stream Projections

If your multi-stream projection shows outdated data under concurrent writes, you're likely hitting write conflicts. When two streams both update the same document inline, the second write can overwrite the first. Switch the projection to async registration, which processes events sequentially and avoids this.

### Data Inconsistent After Redeployment

If you changed your projection logic but existing documents still reflect the old calculations, you need to rebuild. Existing documents were created with the previous logic and won't update themselves. Version your collection name and replay from the event history. See [Version Your Projections](#_3-version-your-projections) above.

## See Also

- [Getting Started - Read Models](/getting-started#read-models)
- [Testing Patterns](/guides/testing) - Testing projections in detail
- [PostgreSQL Event Store](/event-stores/postgresql) - Pongo projections
- [API Reference: Projections](/api-reference/projections)
- [Writing and testing event-driven projections](https://event-driven.io/en/emmett_projections_testing/)
- [Using event metadata in projections](https://event-driven.io/en/projections_and_event_metadata/)
