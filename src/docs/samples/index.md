---
documentationType: reference
outline: deep
---

# Sample Applications

Emmett includes complete sample applications demonstrating real-world usage patterns.

## Available Samples

| Sample                                          | Event Store  | Framework  | Description                |
| ----------------------------------------------- | ------------ | ---------- | -------------------------- |
| [Express + PostgreSQL](#express-postgresql)     | PostgreSQL   | Express.js | Recommended starting point |
| [Express + MongoDB](#express-mongodb)           | MongoDB      | Express.js | Document-oriented approach |
| [Express + EventStoreDB](#express-eventstoredb) | EventStoreDB | Express.js | Native ES capabilities     |

All samples implement the same **Shopping Cart** domain, making it easy to compare different storage backends.

## Express + PostgreSQL {#express-postgresql}

**Location:** [`samples/webApi/expressjs-with-postgresql`](https://github.com/event-driven-io/emmett/tree/main/samples/webApi/expressjs-with-postgresql)

The recommended sample for most users. Demonstrates:

- PostgreSQL event store setup
- Inline projections with Pongo
- Command handling patterns
- Integration testing
- E2E testing with TestContainers

### Running the Sample

```bash
# Clone the repository
git clone https://github.com/event-driven-io/emmett.git
cd emmett/samples/webApi/expressjs-with-postgresql

# Start PostgreSQL
docker-compose up -d

# Install dependencies
npm install

# Run the application
npm run start
```

### Key Files

| File                                 | Purpose                 |
| ------------------------------------ | ----------------------- |
| `src/shoppingCarts/api.ts`           | API route definitions   |
| `src/shoppingCarts/businessLogic.ts` | Decider implementation  |
| `src/shoppingCarts/shoppingCart.ts`  | Events, commands, state |
| `src/app.ts`                         | Application setup       |

### Testing

```bash
# Run all tests
npm run test

# Or use the HTTP file for manual testing
# Open .http file in VS Code with REST Client extension
```

---

## Express + MongoDB {#express-mongodb}

**Location:** [`samples/webApi/expressjs-with-mongodb`](https://github.com/event-driven-io/emmett/tree/main/samples/webApi/expressjs-with-mongodb)

Demonstrates MongoDB as the event store backend:

- MongoDB event store configuration
- Document storage strategies
- MongoDB-specific projections

### Running the Sample

```bash
cd emmett/samples/webApi/expressjs-with-mongodb

# Start MongoDB
docker-compose up -d

# Install and run
npm install
npm run start
```

### Key Differences from PostgreSQL

```typescript
// MongoDB event store setup
import { getMongoDBEventStore } from '@event-driven-io/emmett-mongodb';

const eventStore = getMongoDBEventStore({
  connectionString: 'mongodb://localhost:27017',
  database: 'shopping',
});
```

---

## Express + EventStoreDB {#express-eventstoredb}

**Location:** [`samples/webApi/expressjs-with-esdb`](https://github.com/event-driven-io/emmett/tree/main/samples/webApi/expressjs-with-esdb)

Demonstrates EventStoreDB integration:

- EventStoreDB client setup
- Native subscriptions
- Category projections

### Running the Sample

```bash
cd emmett/samples/webApi/expressjs-with-esdb

# Start EventStoreDB
docker-compose up -d

# Install and run
npm install
npm run start
```

### Key Differences

```typescript
// EventStoreDB setup
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import { EventStoreDBClient } from '@eventstore/db-client';

const client = EventStoreDBClient.connectionString(
  'esdb://localhost:2113?tls=false',
);
const eventStore = getEventStoreDBEventStore(client);
```

---

## Common Patterns Across Samples

### Project Structure

```
samples/webApi/expressjs-with-{store}/
├── src/
│   ├── shoppingCarts/
│   │   ├── api.ts              # HTTP routes
│   │   ├── businessLogic.ts    # Decider (decide/evolve)
│   │   ├── shoppingCart.ts     # Types (events, commands, state)
│   │   └── projections.ts      # Read models (if applicable)
│   ├── app.ts                  # Express setup
│   └── index.ts                # Entry point
├── test/
│   ├── shoppingCart.spec.ts    # Unit tests
│   └── api.spec.ts             # Integration tests
├── docker-compose.yml          # Database setup
├── .http                       # Manual API tests
└── package.json
```

### API Endpoints

All samples expose the same endpoints:

| Method | Endpoint                                                  | Description      |
| ------ | --------------------------------------------------------- | ---------------- |
| POST   | `/clients/:clientId/shopping-carts/:cartId/product-items` | Add product      |
| DELETE | `/clients/:clientId/shopping-carts/:cartId/product-items` | Remove product   |
| POST   | `/clients/:clientId/shopping-carts/:cartId/confirm`       | Confirm cart     |
| DELETE | `/clients/:clientId/shopping-carts/:cartId`               | Cancel cart      |
| GET    | `/clients/:clientId/shopping-carts/:cartId`               | Get cart details |

### Testing with .http Files

Each sample includes a `.http` file for manual testing:

```http
### Add product item
POST http://localhost:3000/clients/client-1/shopping-carts/cart-1/product-items
Content-Type: application/json

{
  "productId": "shoes-123",
  "quantity": 2
}

### Get shopping cart
GET http://localhost:3000/clients/client-1/shopping-carts/cart-1

### Confirm shopping cart
POST http://localhost:3000/clients/client-1/shopping-carts/cart-1/confirm
```

## Choosing a Sample

| If you want to...          | Use this sample         |
| -------------------------- | ----------------------- |
| Get started quickly        | Express + PostgreSQL    |
| Learn with minimal setup   | Express + PostgreSQL    |
| Use MongoDB                | Express + MongoDB       |
| Explore native ES features | Express + EventStoreDB  |
| Understand the patterns    | Any (same domain model) |

## Running Inside Docker

All samples support running the application in Docker:

```bash
# Build application
docker-compose --profile app build

# Run application
docker-compose --profile app up
```

## Next Steps

After exploring the samples:

1. Read the [Getting Started](/getting-started) guide for detailed explanations
2. Check [Choosing an Event Store](/guides/choosing-event-store) for production decisions
3. Explore [Testing Patterns](/guides/testing) for comprehensive testing strategies

## See Also

- [Getting Started](/getting-started) - Full tutorial
- [Express.js Integration](/frameworks/expressjs) - Framework details
- [PostgreSQL Event Store](/event-stores/postgresql) - Storage details
