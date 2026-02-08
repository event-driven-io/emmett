---
documentationType: how-to-guide
outline: deep
---

# Choosing an Event Store

Emmett supports multiple event store backends. This guide helps you select the right one for your project.

## Quick Decision Guide

| If you...                                | Choose                      |
| ---------------------------------------- | --------------------------- |
| Are just starting out                    | **In-Memory** or **SQLite** |
| Want production-ready with familiar tech | **PostgreSQL**              |
| Already use MongoDB                      | **MongoDB**                 |
| Want native Event Sourcing features      | **EventStoreDB**            |
| Need embedded/serverless                 | **SQLite**                  |

## Comparison Matrix

| Feature                  | PostgreSQL     | EventStoreDB  | MongoDB        | SQLite         | In-Memory |
| ------------------------ | -------------- | ------------- | -------------- | -------------- | --------- |
| **Production Ready**     | Yes            | Yes           | Yes            | Limited        | No        |
| **Persistent Storage**   | Yes            | Yes           | Yes            | Yes            | No        |
| **Built-in Projections** | Inline + Async | Async only    | Inline + Async | Inline + Async | Inline    |
| **Multi-tenancy**        | Partitions     | Streams       | Collections    | Separate DBs   | N/A       |
| **Transactions**         | Full ACID      | Stream-level  | Document-level | Full ACID      | N/A       |
| **Horizontal Scaling**   | Yes            | Yes (cluster) | Yes            | No             | No        |
| **Learning Curve**       | Low (SQL)      | Medium        | Low            | Low            | None      |
| **Infrastructure**       | PostgreSQL     | EventStoreDB  | MongoDB        | File/Memory    | None      |

## PostgreSQL

**Best for:** Most production applications, teams with SQL experience.

PostgreSQL is the recommended choice for most applications. It's battle-tested, widely deployed, and your team likely already knows it.

### Strengths

- **Familiar technology** - SQL knowledge transfers directly
- **Rich ecosystem** - Excellent tooling, monitoring, hosting options
- **ACID transactions** - Inline projections in same transaction as events
- **Multi-tenancy** - Native table partitioning for tenant isolation
- **Pongo integration** - Document-style projections with JSONB

### When to Choose

- You want a proven, reliable solution
- Your team knows PostgreSQL
- You need strong transactional guarantees
- You want inline projections with guaranteed consistency

### Installation

```bash
npm install @event-driven-io/emmett-postgresql
```

### Quick Setup

```typescript
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

const eventStore = getPostgreSQLEventStore(
  'postgresql://user:password@localhost:5432/mydb',
);
```

**Documentation:** [PostgreSQL Event Store](/event-stores/postgresql)

---

## EventStoreDB

**Best for:** Teams wanting native Event Sourcing capabilities.

EventStoreDB is purpose-built for Event Sourcing. It offers features specifically designed for event-driven systems.

### Strengths

- **Purpose-built** - Designed specifically for Event Sourcing
- **Stream subscriptions** - Native catch-up and persistent subscriptions
- **Projections** - Server-side JavaScript projections
- **Clustering** - Built-in high availability

### When to Choose

- You want a dedicated Event Sourcing database
- You need advanced subscription features
- You're building a complex event-driven system
- You want server-side projection capabilities

### Installation

```bash
npm install @event-driven-io/emmett-esdb
```

### Quick Setup

```typescript
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import { EventStoreDBClient } from '@eventstore/db-client';

const client = EventStoreDBClient.connectionString(
  'esdb://localhost:2113?tls=false',
);
const eventStore = getEventStoreDBEventStore(client);
```

**Documentation:** [EventStoreDB Event Store](/event-stores/esdb)

---

## MongoDB

**Best for:** Teams already using MongoDB who want Event Sourcing.

MongoDB provides a document-oriented approach to event storage with flexible querying capabilities.

### Strengths

- **Document model** - Natural fit for event data
- **Flexible schemas** - Easy to evolve event structures
- **Familiar for MongoDB users** - Same query patterns
- **Storage strategies** - Multiple approaches for different needs

### When to Choose

- Your team already uses MongoDB
- You want document-oriented storage
- You need flexible event schemas
- You prefer MongoDB's query capabilities

### Installation

```bash
npm install @event-driven-io/emmett-mongodb
```

### Quick Setup

```typescript
import { getMongoDBEventStore } from '@event-driven-io/emmett-mongodb';

const eventStore = getMongoDBEventStore({
  connectionString: 'mongodb://localhost:27017',
  database: 'events',
});
```

**Documentation:** [MongoDB Event Store](/event-stores/mongodb)

---

## SQLite

**Best for:** Development, testing, embedded applications, edge computing.

SQLite provides a lightweight, file-based or in-memory event store perfect for development and specific production scenarios.

### Strengths

- **Zero configuration** - No server to manage
- **File or in-memory** - Flexible storage options
- **Fast for development** - Instant startup
- **Portable** - Single file database
- **Edge computing** - Runs anywhere

### When to Choose

- Local development and testing
- Embedded applications
- Edge/serverless deployments
- Prototyping before choosing production database
- Desktop applications

### Limitations

- Not suitable for high-concurrency production workloads
- Single-writer limitation
- No horizontal scaling

### Installation

```bash
npm install @event-driven-io/emmett-sqlite
```

### Quick Setup

```typescript
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';

// File-based
const eventStore = getSQLiteEventStore('./events.db');

// In-memory
const eventStore = getSQLiteEventStore(':memory:');
```

**Documentation:** [SQLite Event Store](/event-stores/sqlite)

---

## In-Memory

**Best for:** Unit testing and prototyping.

The in-memory event store is included in the core Emmett package. It's perfect for testing and learning.

### Strengths

- **No dependencies** - Included in core package
- **Instant** - No setup, no persistence
- **Perfect for tests** - Fast, isolated, deterministic
- **Learning** - Understand patterns without infrastructure

### When to Choose

- Unit and integration testing
- Learning Emmett
- Prototyping business logic
- Demonstration code

### Limitations

- Data lost on restart
- Not for production

### Quick Setup

```typescript
import { getInMemoryEventStore } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();
```

---

## Migration Between Stores

Emmett's consistent `EventStore` interface makes migration straightforward:

```typescript
// Development
const eventStore = getInMemoryEventStore();

// Testing with real database
const eventStore = getSQLiteEventStore(':memory:');

// Production
const eventStore = getPostgreSQLEventStore(connectionString);
```

Your business logic, command handlers, and projections remain unchanged.

## Decision Flowchart

```
Start
  │
  ├─ Is this for testing/learning?
  │   └─ Yes → In-Memory or SQLite
  │
  ├─ Do you need production persistence?
  │   │
  │   ├─ Already using PostgreSQL?
  │   │   └─ Yes → PostgreSQL
  │   │
  │   ├─ Already using MongoDB?
  │   │   └─ Yes → MongoDB
  │   │
  │   ├─ Want native ES features?
  │   │   └─ Yes → EventStoreDB
  │   │
  │   └─ Not sure?
  │       └─ PostgreSQL (safest choice)
  │
  └─ Need embedded/edge deployment?
      └─ Yes → SQLite
```

## See Also

- [PostgreSQL Event Store](/event-stores/postgresql)
- [EventStoreDB Event Store](/event-stores/esdb)
- [MongoDB Event Store](/event-stores/mongodb)
- [SQLite Event Store](/event-stores/sqlite)
- [Getting Started](/getting-started) - Full tutorial with PostgreSQL
