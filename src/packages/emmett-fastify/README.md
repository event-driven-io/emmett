# @event-driven-io/emmett-fastify

Fastify web framework integration for building event-sourced HTTP APIs with Emmett.

## Purpose

This package provides seamless integration between the Emmett event sourcing library and Fastify, enabling you to build high-performance, event-sourced HTTP APIs. It includes sensible defaults for common plugins (ETag, compression, form body parsing) and automatic graceful shutdown handling.

## Key Concepts

- **Application Factory**: Create pre-configured Fastify instances with essential plugins
- **Graceful Shutdown**: Automatic cleanup via `close-with-grace` when the server stops
- **Plugin System**: Extensible architecture using Fastify's plugin ecosystem
- **Decider Pattern**: Works seamlessly with Emmett's decider-based command handling

## Installation

```bash
npm install @event-driven-io/emmett-fastify
```

Since this package uses peer dependencies, you also need to install:

```bash
npm install @event-driven-io/emmett fastify @fastify/compress @fastify/etag @fastify/formbody close-with-grace
```

## Quick Start

### Basic Application Setup

```typescript
import { getApplication, startAPI } from '@event-driven-io/emmett-fastify';
import { getInMemoryEventStore } from '@event-driven-io/emmett';
import type { FastifyInstance } from 'fastify';

// Create your event store
const eventStore = getInMemoryEventStore();

// Define your routes
const registerRoutes = (app: FastifyInstance) => {
  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/carts/:cartId/items', async (request, reply) => {
    // Handle command with event store
    return reply.code(201).send();
  });
};

// Create and start the application
const app = await getApplication({ registerRoutes });
await startAPI(app, { port: 3000 });
```

### Shopping Cart API Example

Here is a complete example demonstrating the decider pattern with Fastify routes:

```typescript
import {
  DeciderCommandHandler,
  getInMemoryEventStore,
  type EventStore,
  type Decider,
} from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// Define events
type ShoppingCartEvent =
  | {
      type: 'ShoppingCartOpened';
      data: { cartId: string; clientId: string; openedAt: Date };
    }
  | {
      type: 'ProductItemAdded';
      data: { cartId: string; productId: string; quantity: number };
    }
  | {
      type: 'ShoppingCartConfirmed';
      data: { cartId: string; confirmedAt: Date };
    };

// Define commands
type ShoppingCartCommand =
  | {
      type: 'OpenShoppingCart';
      data: { cartId: string; clientId: string; now: Date };
    }
  | {
      type: 'AddProductItem';
      data: { cartId: string; productId: string; quantity: number };
    }
  | { type: 'ConfirmShoppingCart'; data: { cartId: string; now: Date } };

// Define state
type ShoppingCart =
  | { status: 'Empty' }
  | {
      status: 'Pending';
      id: string;
      clientId: string;
      items: Array<{ productId: string; quantity: number }>;
    }
  | { status: 'Confirmed'; id: string; confirmedAt: Date };

// Implement the decider
const decider: Decider<ShoppingCart, ShoppingCartCommand, ShoppingCartEvent> = {
  decide: (command, state) => {
    switch (command.type) {
      case 'OpenShoppingCart':
        return {
          type: 'ShoppingCartOpened',
          data: {
            cartId: command.data.cartId,
            clientId: command.data.clientId,
            openedAt: command.data.now,
          },
        };
      case 'AddProductItem':
        return {
          type: 'ProductItemAdded',
          data: {
            cartId: command.data.cartId,
            productId: command.data.productId,
            quantity: command.data.quantity,
          },
        };
      case 'ConfirmShoppingCart':
        return {
          type: 'ShoppingCartConfirmed',
          data: { cartId: command.data.cartId, confirmedAt: command.data.now },
        };
    }
  },
  evolve: (state, event) => {
    switch (event.type) {
      case 'ShoppingCartOpened':
        return {
          status: 'Pending',
          id: event.data.cartId,
          clientId: event.data.clientId,
          items: [],
        };
      case 'ProductItemAdded':
        if (state.status !== 'Pending') return state;
        return {
          ...state,
          items: [
            ...state.items,
            { productId: event.data.productId, quantity: event.data.quantity },
          ],
        };
      case 'ShoppingCartConfirmed':
        if (state.status !== 'Pending') return state;
        return {
          status: 'Confirmed',
          id: state.id,
          confirmedAt: event.data.confirmedAt,
        };
    }
  },
  initialState: () => ({ status: 'Empty' }),
};

// Create command handler
const handle = DeciderCommandHandler(decider);

// Register routes
const registerRoutes = (eventStore: EventStore) => (app: FastifyInstance) => {
  app.post(
    '/clients/:clientId/shopping-carts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clientId } = request.params as { clientId: string };
      const cartId = clientId;

      await handle(eventStore, cartId, {
        type: 'OpenShoppingCart',
        data: { cartId, clientId, now: new Date() },
      });

      return reply.code(201).send({ id: cartId });
    },
  );

  app.post(
    '/clients/:clientId/shopping-carts/:cartId/items',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { cartId } = request.params as { cartId: string };
      const { productId, quantity } = request.body as {
        productId: string;
        quantity: number;
      };

      await handle(eventStore, cartId, {
        type: 'AddProductItem',
        data: { cartId, productId, quantity },
      });

      return reply.code(204).send();
    },
  );

  app.post(
    '/clients/:clientId/shopping-carts/:cartId/confirm',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { cartId } = request.params as { cartId: string };

      await handle(eventStore, cartId, {
        type: 'ConfirmShoppingCart',
        data: { cartId, now: new Date() },
      });

      return reply.code(204).send();
    },
  );
};

// Start the server
const eventStore = getInMemoryEventStore();
const app = await getApplication({
  registerRoutes: registerRoutes(eventStore),
});
await startAPI(app, { port: 3000 });
```

## How-to Guides

### Custom Server Options

Configure Fastify server options, including logging:

```typescript
const app = await getApplication({
  registerRoutes,
  serverOptions: {
    logger: true, // Enable Fastify logging
  },
});
```

### Custom Plugins

Override or extend the default plugins:

```typescript
import Cors from '@fastify/cors';

const app = await getApplication({
  registerRoutes,
  activeDefaultPlugins: [
    { plugin: Cors, options: { origin: '*' } },
    // Add your custom plugins here
  ],
});
```

### Disable Default Plugins

Start with no default plugins:

```typescript
const app = await getApplication({
  registerRoutes,
  activeDefaultPlugins: [],
});
```

### Testing with Fastify Inject

Use Fastify's built-in `inject` method for testing without starting a server:

```typescript
import { getApplication } from '@event-driven-io/emmett-fastify';
import { getInMemoryEventStore } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();
const app = await getApplication({
  registerRoutes: registerRoutes(eventStore),
});

// Test a route
const response = await app.inject({
  method: 'POST',
  url: '/clients/client-123/shopping-carts',
});

console.log(response.statusCode); // 201
console.log(response.json()); // { id: 'client-123' }
```

### Using with Different Event Stores

The package works with any Emmett event store implementation:

```typescript
// With PostgreSQL
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

const eventStore = getPostgreSQLEventStore(connectionPool);
const app = await getApplication({
  registerRoutes: registerRoutes(eventStore),
});

// With EventStoreDB
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';

const eventStore = getEventStoreDBEventStore(client);
const app = await getApplication({
  registerRoutes: registerRoutes(eventStore),
});
```

## API Reference

### `getApplication(options: ApplicationOptions): Promise<FastifyInstance>`

Creates a configured Fastify application instance.

**Parameters:**

| Option                 | Type                             | Default                      | Description                      |
| ---------------------- | -------------------------------- | ---------------------------- | -------------------------------- |
| `registerRoutes`       | `(app: FastifyInstance) => void` | `undefined`                  | Function to register your routes |
| `serverOptions`        | `{ logger: boolean }`            | `{ logger: true }`           | Fastify server configuration     |
| `activeDefaultPlugins` | `Plugin[]`                       | `[ETag, Compress, FormBody]` | Plugins to register              |

**Returns:** A Promise that resolves to a configured `FastifyInstance`.

### `startAPI(app: FastifyInstance, options?: StartApiOptions): Promise<void>`

Starts the Fastify server.

**Parameters:**

| Option         | Type              | Default  | Description                      |
| -------------- | ----------------- | -------- | -------------------------------- |
| `app`          | `FastifyInstance` | required | The Fastify application instance |
| `options.port` | `number`          | `5000`   | Port number to listen on         |

### `ApplicationOptions`

```typescript
interface ApplicationOptions {
  serverOptions?: { logger: boolean };
  registerRoutes?: (app: FastifyInstance) => void;
  activeDefaultPlugins?: Plugin[];
}
```

### `StartApiOptions`

```typescript
type StartApiOptions = {
  port?: number;
};
```

### `Plugin`

```typescript
type Plugin = {
  plugin: FastifyPluginAsync | FastifyPluginCallback;
  options: FastifyPluginOptions;
};
```

## Architecture

### Default Plugins

The package registers these plugins by default:

| Plugin              | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `@fastify/etag`     | Automatic ETag header generation for caching        |
| `@fastify/compress` | Response compression (disabled globally by default) |
| `@fastify/formbody` | Form body parsing support                           |

### Graceful Shutdown

The application automatically handles graceful shutdown using `close-with-grace`:

- Waits 500ms before forcing shutdown
- Logs any errors during shutdown
- Cleans up listeners when the application closes

### Integration with Emmett Core

This package is designed to work with Emmett's core patterns:

```
Fastify Route -> Command -> DeciderCommandHandler -> EventStore -> Events
```

1. HTTP requests arrive at Fastify routes
2. Routes construct commands from request data
3. `DeciderCommandHandler` processes commands using the decider pattern
4. Events are appended to the event store
5. Responses are sent back to the client

## Dependencies

### Peer Dependencies

| Package                   | Version   | Purpose                     |
| ------------------------- | --------- | --------------------------- |
| `@event-driven-io/emmett` | `0.38.3`  | Core event sourcing library |
| `fastify`                 | `^4.28.1` | Web framework               |
| `@fastify/compress`       | `^7.0.3`  | Response compression        |
| `@fastify/etag`           | `^5.2.0`  | ETag support                |
| `@fastify/formbody`       | `^7.4.0`  | Form body parsing           |
| `close-with-grace`        | `^2.1.0`  | Graceful shutdown           |
