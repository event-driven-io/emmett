---
documentationType: reference
outline: deep
---

# Packages

Emmett is organized as a modular monorepo. Install only what you need.

## Core Package

### @event-driven-io/emmett

The foundation of the Emmett ecosystem. Required for all projects.

```bash
npm install @event-driven-io/emmett
```

**Provides:**
- Event and Command type definitions
- Decider pattern implementation
- In-memory event store for testing
- Command handling utilities
- Projection building blocks

📦 [npm](https://www.npmjs.com/package/@event-driven-io/emmett) · [GitHub](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett) · [README](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett#readme)

## Event Store Packages

Choose one based on your infrastructure needs.

### @event-driven-io/emmett-postgresql

Production-ready PostgreSQL event store with Pongo integration.

```bash
npm install @event-driven-io/emmett-postgresql
```

**Features:**
- Inline and async projections
- Pongo document database integration
- Full ACID transactions
- Background message consumers

📦 [npm](https://www.npmjs.com/package/@event-driven-io/emmett-postgresql) · [GitHub](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-postgresql) · [Docs](/event-stores/postgresql)

### @event-driven-io/emmett-esdb

EventStoreDB integration for native Event Sourcing.

```bash
npm install @event-driven-io/emmett-esdb
```

**Features:**
- Persistent subscriptions
- Global event ordering
- Built-in projections
- Optimized for Event Sourcing

📦 [npm](https://www.npmjs.com/package/@event-driven-io/emmett-esdb) · [GitHub](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-esdb) · [Docs](/event-stores/esdb)

### @event-driven-io/emmett-mongodb

MongoDB event store with flexible storage strategies.

```bash
npm install @event-driven-io/emmett-mongodb
```

**Features:**
- Single or multi-collection storage
- Document-per-stream option
- MongoDB aggregation pipelines
- Atlas-compatible

📦 [npm](https://www.npmjs.com/package/@event-driven-io/emmett-mongodb) · [GitHub](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-mongodb) · [Docs](/event-stores/mongodb)

### @event-driven-io/emmett-sqlite

Lightweight SQLite event store for development and embedded apps.

```bash
npm install @event-driven-io/emmett-sqlite
```

**Features:**
- File-based or in-memory
- Zero configuration
- Fast test execution
- better-sqlite3 powered

📦 [npm](https://www.npmjs.com/package/@event-driven-io/emmett-sqlite) · [GitHub](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-sqlite) · [Docs](/event-stores/sqlite)

## Web Framework Packages

### @event-driven-io/emmett-expressjs

Express.js integration with testing utilities.

```bash
npm install @event-driven-io/emmett-expressjs
```

**Features:**
- Application factory
- Problem Details (RFC 9457)
- ETag concurrency handling
- ApiSpecification for testing

📦 [npm](https://www.npmjs.com/package/@event-driven-io/emmett-expressjs) · [GitHub](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-expressjs) · [Docs](/frameworks/expressjs)

### @event-driven-io/emmett-fastify

Fastify integration with plugin architecture.

```bash
npm install @event-driven-io/emmett-fastify
```

**Features:**
- Plugin-based setup
- Schema validation
- Graceful shutdown
- Fastify inject testing

📦 [npm](https://www.npmjs.com/package/@event-driven-io/emmett-fastify) · [GitHub](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-fastify) · [Docs](/frameworks/fastify)

## Testing Package

### @event-driven-io/emmett-testcontainers

TestContainers integration for E2E testing.

```bash
npm install -D @event-driven-io/emmett-testcontainers
```

**Features:**
- Pre-configured containers for PostgreSQL, MongoDB, EventStoreDB
- Docker Compose integration
- Automatic cleanup
- CI/CD optimized

📦 [npm](https://www.npmjs.com/package/@event-driven-io/emmett-testcontainers) · [GitHub](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-testcontainers)

## Utility Package

### @event-driven-io/emmett-shims

Polyfills for environments without native support.

```bash
npm install @event-driven-io/emmett-shims
```

**Features:**
- AsyncIterator support
- Environment detection
- Edge runtime compatibility

📦 [npm](https://www.npmjs.com/package/@event-driven-io/emmett-shims) · [GitHub](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-shims)

## Package Compatibility

All packages follow semantic versioning. Major versions are released together to ensure compatibility.

| Package | Current Version | Node.js |
|---------|-----------------|---------|
| emmett | ![npm](https://img.shields.io/npm/v/@event-driven-io/emmett) | ≥18.0 |
| emmett-postgresql | ![npm](https://img.shields.io/npm/v/@event-driven-io/emmett-postgresql) | ≥18.0 |
| emmett-esdb | ![npm](https://img.shields.io/npm/v/@event-driven-io/emmett-esdb) | ≥18.0 |
| emmett-mongodb | ![npm](https://img.shields.io/npm/v/@event-driven-io/emmett-mongodb) | ≥18.0 |
| emmett-sqlite | ![npm](https://img.shields.io/npm/v/@event-driven-io/emmett-sqlite) | ≥18.0 |
| emmett-expressjs | ![npm](https://img.shields.io/npm/v/@event-driven-io/emmett-expressjs) | ≥18.0 |
| emmett-fastify | ![npm](https://img.shields.io/npm/v/@event-driven-io/emmett-fastify) | ≥18.0 |
| emmett-testcontainers | ![npm](https://img.shields.io/npm/v/@event-driven-io/emmett-testcontainers) | ≥18.0 |
| emmett-shims | ![npm](https://img.shields.io/npm/v/@event-driven-io/emmett-shims) | ≥18.0 |

## Typical Project Setup

### API with PostgreSQL

```bash
npm install @event-driven-io/emmett \
            @event-driven-io/emmett-postgresql \
            @event-driven-io/emmett-expressjs

npm install -D @event-driven-io/emmett-testcontainers
```

### API with EventStoreDB

```bash
npm install @event-driven-io/emmett \
            @event-driven-io/emmett-esdb \
            @event-driven-io/emmett-fastify

npm install -D @event-driven-io/emmett-testcontainers
```

### API with MongoDB

```bash
npm install @event-driven-io/emmett \
            @event-driven-io/emmett-mongodb \
            @event-driven-io/emmett-expressjs

npm install -D @event-driven-io/emmett-testcontainers
```

## Related Projects

### Pongo

PostgreSQL as a Document Database with MongoDB-like API.

```bash
npm install @event-driven-io/pongo
```

📦 [npm](https://www.npmjs.com/package/@event-driven-io/pongo) · [GitHub](https://github.com/event-driven-io/pongo)

## See Also

- [Getting Started](/getting-started) - Complete tutorial
- [Choosing an Event Store](/guides/choosing-event-store) - Detailed comparison
- [Samples](/samples/) - Working examples
