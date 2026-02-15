---
outline: deep
---

# Frequently Asked Questions

Common questions and solutions based on real issues from the Emmett community.

## General

### What is Emmett?

Emmett is an opinionated yet flexible framework that implements Event Sourcing for Node.js applications. It provides lightweight abstractions for event stores, command handling, projections, and testing utilities.

### Which event stores does Emmett support?

Emmett supports multiple backends:

| Event Store  | Package                              | Production Ready | Best For                                        |
| ------------ | ------------------------------------ | ---------------- | ----------------------------------------------- |
| PostgreSQL   | `@event-driven-io/emmett-postgresql` | ✅ Yes           | Production apps needing ACID guarantees         |
| EventStoreDB | `@event-driven-io/emmett-esdb`       | ✅ Yes           | Native event sourcing with built-in projections |
| MongoDB      | `@event-driven-io/emmett-mongodb`    | ⚠️ Beta          | Document-oriented workflows                     |
| SQLite       | `@event-driven-io/emmett-sqlite`     | ⚠️ Beta          | Development, testing, embedded apps             |
| In-Memory    | `@event-driven-io/emmett`            | ✅ Yes           | Unit testing, prototyping                       |

See [Choosing an Event Store](/guides/choosing-event-store) for detailed comparisons.

### Can I use Emmett without the Command Handler?

Yes! You can use the event store directly without the command handler pattern. The event store provides a straightforward API for appending and reading events:

```typescript
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

const eventStore = getPostgreSQLEventStore(connectionString);

// Append events directly
await eventStore.appendToStream('order-123', [
  { type: 'OrderCreated', data: { orderId: '123', customerId: 'c-1' } },
  { type: 'ItemAdded', data: { productId: 'p-1', quantity: 2 } },
]);

// Read events
const { events } = await eventStore.readStream('order-123');
```

See the [Event Store API Reference](/api-reference/eventstore) for full documentation.

_Related: [GitHub Issue #284](https://github.com/event-driven-io/emmett/issues/284)_

---

## Installation & Setup

### How do I install Emmett?

```bash
# Core package (required)
npm install @event-driven-io/emmett

# Choose your event store
npm install @event-driven-io/emmett-postgresql  # PostgreSQL
npm install @event-driven-io/emmett-esdb        # EventStoreDB
npm install @event-driven-io/emmett-mongodb     # MongoDB
npm install @event-driven-io/emmett-sqlite      # SQLite

# Optional: Web framework integration
npm install @event-driven-io/emmett-expressjs   # Express.js
npm install @event-driven-io/emmett-fastify     # Fastify

# Optional: Testing utilities
npm install @event-driven-io/emmett-testcontainers
```

### I'm getting TypeScript build errors with `skipLibCheck: false`

**Problem:** TypeScript errors like `Cannot find module '@event-driven-io/emmett/src'` when building with `skipLibCheck: false`.

**Solution:** Upgrade to Emmett version `0.38.0` or later. This issue was fixed in `0.38.0-alpha.3`.

```bash
npm install @event-driven-io/emmett@latest @event-driven-io/emmett-postgresql@latest
```

_Related: [GitHub Issue #240](https://github.com/event-driven-io/emmett/issues/240)_

### How do I use Emmett with Express.js v5?

Express.js v5 support is in progress. Currently, Emmett uses Express v4. You can:

1. Use Express v4 (recommended for now)
2. Use the event store directly without `emmett-expressjs`
3. Watch [GitHub Issue #267](https://github.com/event-driven-io/emmett/issues/267) for v5 support

```typescript
// Using event store directly with Express v5
import express from 'express';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

const app = express();
const eventStore = getPostgreSQLEventStore(connectionString);

app.post('/orders', async (req, res) => {
  const result = await eventStore.appendToStream(`order-${req.body.orderId}`, [
    { type: 'OrderCreated', data: req.body },
  ]);
  res.json({ streamPosition: result.nextExpectedStreamVersion });
});
```

### TestContainers fails with "Could not find a working container runtime strategy"

**Problem:** When using Podman instead of Docker, TestContainers may not detect it.

**Solution:** Configure Podman to be Docker-compatible:

```bash
# Linux: Enable Podman socket
systemctl --user enable --now podman.socket

# Set Docker host environment variable
export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock

# macOS with Podman Machine
podman machine init
podman machine start
export DOCKER_HOST="unix://$HOME/.local/share/containers/podman/machine/podman.sock"
```

_Related: [GitHub Issue #198](https://github.com/event-driven-io/emmett/issues/198)_

---

## Event Store

### Events are returned in the wrong order from `readStream`

**Problem:** When appending events rapidly, `readStream` sometimes returns them out of order.

**Solution:** This was fixed in version `0.38.0`. Upgrade to the latest version:

```bash
npm install @event-driven-io/emmett-postgresql@latest
```

The fix ensures explicit `ORDER BY stream_position` in SQL queries.

_Related: [GitHub Issue #239](https://github.com/event-driven-io/emmett/issues/239)_

### PostgreSQL doesn't respect schema in connection URL

**Problem:** Setting schema via connection URL (`?schema=myschema`) doesn't work.

**Workaround:** Use explicit schema configuration:

```typescript
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

const eventStore = getPostgreSQLEventStore(connectionString, {
  schema: 'my_custom_schema',
});
```

_Related: [GitHub Issue #95](https://github.com/event-driven-io/emmett/issues/95)_

### How do I configure event store options?

Each event store has specific configuration options:

```typescript
// PostgreSQL
const pgStore = getPostgreSQLEventStore(connectionString, {
  schema: 'events',
  projections: [myProjection],
});

// EventStoreDB
const esdbStore = getEventStoreDBEventStore(client, {
  projections: [myProjection],
});

// MongoDB
const mongoStore = getMongoDBEventStore({
  client: mongoClient,
  database: 'myapp',
  projections: [myProjection],
});

// SQLite
const sqliteStore = getSQLiteEventStore({
  fileName: './events.db', // or ':memory:' for in-memory
  projections: [myProjection],
});
```

---

## Projections

### My projection handler only receives the last event, not all events

**Problem:** `postgreSQLProjection` handler receives only the newly appended event, not the full stream.

**This is expected behavior.** Inline projections receive only new events as they're appended. To build state:

**Option 1: Load current state from read model (recommended)**

```typescript
const myProjection = postgreSQLProjection({
  name: 'OrderSummary',
  handle: async (events, { db }) => {
    for (const event of events) {
      const streamId = event.metadata.streamName;

      // Load current state from read model
      const current = await db.query(
        'SELECT * FROM order_summaries WHERE id = $1',
        [streamId],
      );

      // Apply event to current state
      const updated = evolve(current.rows[0] ?? initialState(), event);

      // Upsert updated state
      await db.query(
        `INSERT INTO order_summaries (id, data) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET data = $2`,
        [streamId, updated],
      );
    }
  },
});
```

**Option 2: Read full stream (less efficient)**

```typescript
handle: async (events, { eventStore }) => {
  const streamId = events[0].metadata.streamName;
  const { events: allEvents } = await eventStore.readStream(streamId);
  const state = allEvents.reduce(evolve, initialState());
  // Save state...
};
```

_Related: [GitHub Issue #263](https://github.com/event-driven-io/emmett/issues/263)_

### How do I test projections without Given/When/Then?

**Problem:** Projection tests don't need a "when" step, just "given events" and "then assertions".

**Current approach:** Pass an empty array to `when`:

```typescript
await given([
  { type: 'OrderCreated', data: {...}, metadata: { streamName: 'order-1' } }
])
  .when([]) // Empty when
  .then(
    expectPongoDocuments
      .fromCollection('orders')
      .withId('order-1')
      .toBeEqual({ status: 'created' })
  );
```

_Related: [GitHub Issue #253](https://github.com/event-driven-io/emmett/issues/253)_

### Can I replay projections from a specific point in time?

This feature is planned but not yet implemented. Currently, projections are rebuilt from the beginning of the stream.

_Related: [GitHub Issue #185](https://github.com/event-driven-io/emmett/issues/185)_

---

## MongoDB

### `ObjectId` values cause errors in projection filters

**Problem:** Using `ObjectId` in filters passed to `eventStore.projections.inline.find()` throws `TypeError: Cannot delete property '0'`.

**Workaround:** Convert `ObjectId` to string in filters:

```typescript
// Instead of
const result = await eventStore.projections.inline.find({
  _id: new ObjectId('...'),
});

// Use string
const result = await eventStore.projections.inline.find({
  _id: '...', // as string
});
```

_Related: [GitHub Issue #266](https://github.com/event-driven-io/emmett/issues/266)_

### MongoDB filter objects are mutated

**Problem:** `projections.inline.find` and `findOne` mutate the filter object passed to them.

**Workaround:** Clone your filter before passing:

```typescript
const filter = { userId: 'u-1' };
const result = await eventStore.projections.inline.find({ ...filter });
```

_Related: [GitHub Issue #168](https://github.com/event-driven-io/emmett/issues/168)_

---

## EventStoreDB

### Subscriptions stop after running for a while

**Problem:** ESDB subscriptions drop after ~30+ hours with "Subscription stopped" logs.

**Solution:** This was addressed in recent releases with improved reconnection handling. Update to the latest version:

```bash
npm install @event-driven-io/emmett-esdb@latest
```

The consumer now automatically restarts subscriptions when they drop.

_Related: [GitHub Issue #233](https://github.com/event-driven-io/emmett/issues/233)_

---

## Testing

### Deep equals assertion fails due to type coercion

**Problem:** String values that look like numbers (e.g., `"2"`) are coerced to bigint in assertions, causing false failures.

**Workaround:** Ensure consistent types in your test data:

```typescript
// Use explicit string values
const itemId = 'item-2'; // Not just '2'
```

_Related: [GitHub Issue #255](https://github.com/event-driven-io/emmett/issues/255)_

### SQLite tests interfere with each other

**Problem:** SQLite integration tests use a fixed database file, causing race conditions when running in parallel.

**Best practice:** Use unique database files per test:

```typescript
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const tempDir = await mkdtemp(join(tmpdir(), 'emmett-test-'));
const dbPath = join(tempDir, `test-${Date.now()}.db`);

const eventStore = getSQLiteEventStore({ fileName: dbPath });
```

_Related: [GitHub Issue #232](https://github.com/event-driven-io/emmett/issues/232)_

---

## Web Frameworks

### How do I customize Express.js middleware order?

If you need fine-grained control over middleware, use the event store directly instead of `emmett-expressjs`:

```typescript
import express from 'express';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { CommandHandler } from '@event-driven-io/emmett';

const app = express();

// Your middleware in your order
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(authMiddleware);

const eventStore = getPostgreSQLEventStore(connectionString);
const handle = CommandHandler({ evolve, initialState });

app.post('/carts/:id/add', async (req, res) => {
  const result = await handle(eventStore, req.params.id, (state) =>
    addProduct(req.body, state),
  );
  res.json(result);
});
```

_Related: [GitHub Issue #267 comments](https://github.com/event-driven-io/emmett/issues/267)_

---

## Compatibility

### Does Emmett work with Vercel or Supabase?

These integrations are being explored. For now:

- **Vercel:** Use connection pooling (Prisma Data Proxy or similar)
- **Supabase:** Use direct PostgreSQL connection string

See [GitHub Issue #94](https://github.com/event-driven-io/emmett/issues/94) for Vercel and [GitHub Issue #93](https://github.com/event-driven-io/emmett/issues/93) for Supabase updates.

### Can I use Emmett in the browser?

Yes, the core package and in-memory event store work in browsers. Issues with earlier versions have been fixed.

```typescript
import { InMemoryEventStore, Event } from '@event-driven-io/emmett';

const eventStore = new InMemoryEventStore();
```

_Related: [GitHub Issue #64](https://github.com/event-driven-io/emmett/issues/64), [GitHub Issue #74](https://github.com/event-driven-io/emmett/issues/74)_

---

## Getting Help

### Where can I get help?

- 💬 **Discord**: [Join the Emmett Community](https://discord.gg/fTpqUTMmVa) for quick questions
- 💬 **GitHub Discussions**: [Start a discussion](https://github.com/event-driven-io/emmett/discussions) for longer topics
- 🐛 **GitHub Issues**: [Report bugs](https://github.com/event-driven-io/emmett/issues) with reproduction steps

### How do I report a bug?

Include:

- Emmett package versions
- Node.js version
- Minimal reproduction code
- Expected vs actual behavior
- Error messages and stack traces

### How can I contribute?

See the [Contributing Guide](/resources/contributing) for setup instructions and guidelines. We welcome:

- Bug fixes
- Documentation improvements
- New features (discuss first in GitHub Issues)
- Test coverage improvements

---

## See Also

- [Getting Started](/getting-started) - Build your first Emmett app
- [API Reference](/api-reference/) - Detailed API documentation
- [GitHub Issues](https://github.com/event-driven-io/emmett/issues) - Current known issues
- [Discord Community](https://discord.gg/fTpqUTMmVa) - Get help from the community
