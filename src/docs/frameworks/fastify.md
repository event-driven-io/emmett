---
documentationType: reference
outline: deep
---

# Fastify Integration

Emmett's Fastify integration provides a high-performance alternative to Express.js for building event-sourced web APIs.

## Overview

The `@event-driven-io/emmett-fastify` package provides:

- **Fastify server setup** - Sensible defaults with plugin system
- **Graceful shutdown** - Proper cleanup of connections
- **Built-in plugins** - ETag, compression, form body parsing
- **Testing utilities** - Using Fastify's inject method

## Installation

```bash
npm install @event-driven-io/emmett-fastify
```

### Peer Dependencies

```bash
npm install @event-driven-io/emmett fastify
```

## Quick Start

### Basic Setup

```typescript
import { startAPI, getFastifyApp } from '@event-driven-io/emmett-fastify';
import { getInMemoryEventStore } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();

const app = getFastifyApp({
  apis: [shoppingCartApi(eventStore)],
});

await startAPI(app, { port: 3000 });
```

### Defining Routes

```typescript
import type { FastifyInstance } from 'fastify';

export const shoppingCartApi =
  (eventStore: EventStore) => async (fastify: FastifyInstance) => {
    const handle = CommandHandler(eventStore, shoppingCartDecider);

    // GET - Read shopping cart
    fastify.get('/carts/:cartId', async (request, reply) => {
      const { cartId } = request.params as { cartId: string };

      const { state, currentStreamVersion } = await eventStore.aggregateStream(
        `shopping_cart-${cartId}`,
        { evolve, initialState },
      );

      if (currentStreamVersion === 0n) {
        return reply.status(404).send({ detail: 'Cart not found' });
      }

      return reply.header('ETag', `"${currentStreamVersion}"`).send(state);
    });

    // POST - Add product item
    fastify.post('/carts/:cartId/items', async (request, reply) => {
      const { cartId } = request.params as { cartId: string };
      const { productId, quantity } = request.body as {
        productId: string;
        quantity: number;
      };

      const result = await handle(cartId, {
        type: 'AddProductItem',
        data: { productId, quantity, price: await getPrice(productId) },
      });

      return reply
        .header('ETag', `"${result.nextExpectedStreamVersion}"`)
        .send({ success: true });
    });

    // POST - Confirm cart
    fastify.post('/carts/:cartId/confirm', async (request, reply) => {
      const { cartId } = request.params as { cartId: string };

      await handle(cartId, {
        type: 'ConfirmShoppingCart',
        data: { confirmedAt: new Date() },
      });

      return reply.send({ status: 'Confirmed' });
    });
  };
```

## Complete Example

```typescript
import { startAPI, getFastifyApp } from '@event-driven-io/emmett-fastify';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { CommandHandler } from '@event-driven-io/emmett';

// Define your decider
const shoppingCartDecider = {
  decide,
  evolve,
  initialState,
  mapToStreamId: (id: string) => `shopping_cart-${id}`,
};

// Create event store
const eventStore = getPostgreSQLEventStore(process.env.DATABASE_URL!);

// Define API
const shoppingCartApi =
  (eventStore: EventStore) => async (fastify: FastifyInstance) => {
    const handle = CommandHandler(shoppingCartDecider, eventStore);

    fastify.post<{
      Params: { cartId: string };
      Body: { productId: string; quantity: number };
    }>('/carts/:cartId/items', async (request, reply) => {
      const { cartId } = request.params;
      const { productId, quantity } = request.body;

      const price = await getPriceFromCatalog(productId);

      const result = await handle(cartId, {
        type: 'AddProductItem',
        data: { productId, quantity, price },
      });

      return reply
        .header('ETag', `"${result.nextExpectedStreamVersion}"`)
        .status(200)
        .send({ added: true });
    });
  };

// Start server
const app = getFastifyApp({
  apis: [shoppingCartApi(eventStore)],
});

await startAPI(app, { port: 3000 });
```

## Default Plugins

Emmett's Fastify setup includes these plugins by default:

| Plugin              | Purpose                   |
| ------------------- | ------------------------- |
| `@fastify/etag`     | Automatic ETag generation |
| `@fastify/compress` | Response compression      |
| `@fastify/formbody` | Form body parsing         |

### Disabling Default Plugins

```typescript
const app = getFastifyApp({
  apis: [myApi],
  disableDefaultPlugins: ['etag', 'compress'],
});
```

## Custom Configuration

### Server Options

```typescript
const app = getFastifyApp({
  apis: [myApi],
  serverOptions: {
    logger: true,
    trustProxy: true,
    maxParamLength: 200,
  },
});
```

### Custom Plugins

```typescript
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';

const app = getFastifyApp({
  apis: [myApi],
  plugins: [
    [cors, { origin: true }],
    [helmet, {}],
  ],
});
```

### Before/After Hooks

```typescript
const app = getFastifyApp({
  apis: [myApi],
  beforeRoutes: async (fastify) => {
    // Register plugins, decorators, etc.
    await fastify.register(authPlugin);
  },
  afterRoutes: async (fastify) => {
    // Add error handlers, not-found handlers, etc.
    fastify.setNotFoundHandler((request, reply) => {
      reply.status(404).send({ error: 'Not found' });
    });
  },
});
```

## Graceful Shutdown

Emmett handles graceful shutdown automatically:

```typescript
await startAPI(app, {
  port: 3000,
  onClose: async () => {
    // Clean up resources
    await eventStore.close();
    await database.disconnect();
  },
});

// Handles SIGINT, SIGTERM gracefully
```

## Testing

### Using Fastify Inject

```typescript
describe('Shopping Cart API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const eventStore = getInMemoryEventStore();

    app = getFastifyApp({
      apis: [shoppingCartApi(eventStore)],
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('adds product to cart', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/carts/123/items',
      payload: {
        productId: 'shoes-1',
        quantity: 2,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ added: true });
  });

  it('returns 404 for missing cart', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/carts/nonexistent',
    });

    expect(response.statusCode).toBe(404);
  });
});
```

### With Different Event Stores

```typescript
describe('Shopping Cart API (PostgreSQL)', () => {
  let postgres: StartedPostgreSqlContainer;
  let app: FastifyInstance;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer().start();
    const eventStore = getPostgreSQLEventStore(postgres.getConnectionUri());

    app = getFastifyApp({
      apis: [shoppingCartApi(eventStore)],
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await postgres.stop();
  });

  // Tests...
});
```

## Type Safety

Fastify provides excellent TypeScript support:

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// Define route schemas
interface AddItemParams {
  cartId: string;
}

interface AddItemBody {
  productId: string;
  quantity: number;
}

interface AddItemResponse {
  added: boolean;
  newTotal: number;
}

fastify.post<{
  Params: AddItemParams;
  Body: AddItemBody;
  Reply: AddItemResponse;
}>(
  '/carts/:cartId/items',
  {
    schema: {
      params: {
        type: 'object',
        properties: {
          cartId: { type: 'string' },
        },
        required: ['cartId'],
      },
      body: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          quantity: { type: 'integer', minimum: 1 },
        },
        required: ['productId', 'quantity'],
      },
    },
  },
  async (request, reply) => {
    // request.params.cartId is typed as string
    // request.body.productId is typed as string
    // request.body.quantity is typed as number
  },
);
```

## Error Handling

```typescript
fastify.setErrorHandler((error, request, reply) => {
  if (error instanceof ValidationError) {
    return reply.status(400).send({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: error.message,
    });
  }

  if (error instanceof IllegalStateError) {
    return reply.status(403).send({
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: error.message,
    });
  }

  // Log unexpected errors
  request.log.error(error);

  return reply.status(500).send({
    type: 'about:blank',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred',
  });
});
```

## Full Package Documentation

For complete API reference and advanced usage, see the [package README](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-fastify).

## See Also

- [Express.js Integration](/frameworks/expressjs) - Alternative framework
- [Error Handling](/guides/error-handling) - Error patterns
- [Testing Patterns](/guides/testing) - Testing strategies
