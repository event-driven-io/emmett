# @event-driven-io/emmett-testcontainers

Testcontainers integration for running EventStoreDB in Docker containers during integration and end-to-end testing.

## Purpose

This package provides a pre-configured Docker container wrapper for EventStoreDB, enabling isolated database testing without manual infrastructure setup. It handles container lifecycle management, supports both x86 and ARM64 architectures, and offers shared container functionality to optimize test suite performance.

## Key Concepts

| Concept                          | Description                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| **EventStoreDBContainer**        | A configured Docker container wrapper extending Testcontainers' `GenericContainer` |
| **StartedEventStoreDBContainer** | A running container instance providing connection strings and client access        |
| **Shared Container**             | Thread-safe singleton pattern for reusing a single container across multiple tests |
| **Architecture Detection**       | Automatic selection of appropriate Docker image for x86 or ARM64 systems           |

## Installation

Install the package using your preferred package manager:

```bash
npm add @event-driven-io/emmett-testcontainers
# or
pnpm add @event-driven-io/emmett-testcontainers
# or
yarn add @event-driven-io/emmett-testcontainers
```

You also need to install the EventStoreDB client as a peer dependency:

```bash
npm add @eventstore/db-client
```

## Quick Start

### Basic Container Usage

Start a container, run your tests, and stop it:

```typescript
import { EventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import { jsonEvent } from '@eventstore/db-client';

// Start the container
const container = await new EventStoreDBContainer().start();

try {
  // Get a client connected to the container
  const client = container.getClient();

  // Use the client for your tests
  const result = await client.appendToStream(
    'my-stream',
    jsonEvent({ type: 'UserCreated', data: { userId: '123', name: 'Alice' } }),
  );

  console.log('Event appended:', result.success);
} finally {
  // Always stop the container when done
  await container.stop();
}
```

### Shared Container for Test Suites

For test suites with multiple test files, use the shared container to avoid starting a new container for each test:

```typescript
import {
  getSharedEventStoreDBTestContainer,
  releaseSharedEventStoreDBTestContainer,
} from '@event-driven-io/emmett-testcontainers';
import { describe, it, after } from 'node:test';

describe('My Event Store Tests', () => {
  after(async () => {
    // Release the shared container after all tests
    await releaseSharedEventStoreDBTestContainer();
  });

  it('should append events', async () => {
    const container = await getSharedEventStoreDBTestContainer();
    const client = container.getClient();

    // Your test logic here
  });

  it('should read events', async () => {
    const container = await getSharedEventStoreDBTestContainer();
    const client = container.getClient();

    // Your test logic here
  });
});
```

## How-to Guides

### Configure Container Options

Customize the container behavior using `EventStoreDBContainerOptions`:

```typescript
import {
  EventStoreDBContainer,
  EVENTSTOREDB_DEFAULT_IMAGE,
} from '@event-driven-io/emmett-testcontainers';

const container = new EventStoreDBContainer(EVENTSTOREDB_DEFAULT_IMAGE, {
  disableProjections: false, // Enable EventStoreDB projections (default: false)
  isSecure: false, // Run without TLS (default: false)
  useFileStorage: true, // Persist data to disk instead of memory
  withReuse: true, // Reuse container across test runs (Testcontainers feature)
});

const started = await container.start();
```

### Use a Custom Docker Image

Specify a different EventStoreDB image:

```typescript
import { EventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';

const container = new EventStoreDBContainer(
  'eventstore/eventstore:23.10.0-bookworm-slim',
);
const started = await container.start();
```

### Get Connection String for External Clients

If you need to connect with your own client configuration:

```typescript
const container = await new EventStoreDBContainer().start();

// Get the connection string with mapped port
const connectionString = container.getConnectionString();
// Returns: esdb://localhost:32768?tls=false (port is dynamically mapped)

// Use with your own client setup
import { EventStoreDBClient } from '@eventstore/db-client';
const client = EventStoreDBClient.connectionString(connectionString);
```

### Use getEventStoreDBTestClient Helper

For simple test setups with optional Testcontainers support:

```typescript
import { getEventStoreDBTestClient } from '@event-driven-io/emmett-testcontainers';

// Use Testcontainers
const client = await getEventStoreDBTestClient(true);

// Or connect to a local EventStoreDB instance (localhost:2113)
const localClient = await getEventStoreDBTestClient(false);
```

## API Reference

### Constants

| Constant                       | Value                     | Description                                  |
| ------------------------------ | ------------------------- | -------------------------------------------- |
| `EVENTSTOREDB_PORT`            | `2113`                    | Default EventStoreDB HTTP/gRPC port          |
| `EVENTSTOREDB_IMAGE_NAME`      | `'eventstore/eventstore'` | Docker image name                            |
| `EVENTSTOREDB_IMAGE_TAG`       | `'24.10.0-bookworm-slim'` | x86 image tag                                |
| `EVENTSTOREDB_ARM64_IMAGE_TAG` | `'24.10.0-alpha-arm64v8'` | ARM64 image tag                              |
| `EVENTSTOREDB_DEFAULT_IMAGE`   | Auto-detected             | Full image name based on system architecture |

### EventStoreDBContainerOptions

Configuration options for the container:

| Option               | Type      | Default | Description                                         |
| -------------------- | --------- | ------- | --------------------------------------------------- |
| `disableProjections` | `boolean` | `false` | When `true`, disables EventStoreDB projections      |
| `isSecure`           | `boolean` | `false` | When `true`, enables TLS security                   |
| `useFileStorage`     | `boolean` | `false` | When `true`, uses file storage instead of in-memory |
| `withReuse`          | `boolean` | `false` | When `true`, enables Testcontainers reuse feature   |

### EventStoreDBContainer

Extends Testcontainers' `GenericContainer` with EventStoreDB-specific configuration.

```typescript
class EventStoreDBContainer extends GenericContainer {
  constructor(
    image?: string, // Default: EVENTSTOREDB_DEFAULT_IMAGE
    options?: EventStoreDBContainerOptions, // Default: defaultEventStoreDBContainerOptions
  );

  start(): Promise<StartedEventStoreDBContainer>;
}
```

### StartedEventStoreDBContainer

A running EventStoreDB container with access methods.

```typescript
class StartedEventStoreDBContainer extends AbstractStartedContainer {
  getConnectionString(): string; // Returns esdb:// connection string
  getClient(): EventStoreDBClient; // Returns configured client instance
}
```

### Shared Container Functions

Thread-safe functions for sharing a single container across tests:

| Function                                   | Description                                       |
| ------------------------------------------ | ------------------------------------------------- |
| `getSharedEventStoreDBTestContainer()`     | Gets or creates the shared container instance     |
| `getSharedTestEventStoreDBClient()`        | Gets a client from the shared container           |
| `releaseSharedEventStoreDBTestContainer()` | Decrements usage count; stops container when zero |

### getEventStoreDBTestClient

Helper function for quick test setup:

```typescript
function getEventStoreDBTestClient(
  useTestContainers?: boolean, // Default: false
): Promise<EventStoreDBClient>;
```

## Dependencies

| Package                   | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `@event-driven-io/emmett` | Provides `InProcessLock` for thread-safe container management |
| `testcontainers`          | Docker container management and lifecycle                     |
| `@eventstore/db-client`   | EventStoreDB client (peer dependency)                         |
