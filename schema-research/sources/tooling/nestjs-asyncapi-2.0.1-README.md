# nestjs-asyncapi

[![npm version](https://img.shields.io/npm/v/nestjs-asyncapi.svg)](https://www.npmjs.com/package/nestjs-asyncapi)
[![npm downloads](https://img.shields.io/npm/dm/nestjs-asyncapi.svg)](https://www.npmjs.com/package/nestjs-asyncapi)
[![CI](https://github.com/flamewow/nestjs-asyncapi/actions/workflows/base.yml/badge.svg)](https://github.com/flamewow/nestjs-asyncapi/actions/workflows/base.yml)
[![License](https://img.shields.io/npm/l/nestjs-asyncapi.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/nestjs-asyncapi.svg)](https://www.npmjs.com/package/nestjs-asyncapi)

A NestJS module that auto-generates [AsyncAPI 3.0](https://www.asyncapi.com/docs/reference/specification/v3.0.0) documentation for event-driven services — WebSocket gateways, microservices, and any class with the `@AsyncApi*` decorators — in the same style as [`@nestjs/swagger`](https://github.com/nestjs/swagger) for HTTP.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Usage](#usage)
  - [Express vs Fastify](#express-vs-fastify)
  - [WebSocket gateways](#websocket-gateways)
  - [Microservices](#microservices)
  - [Channel bindings (Kafka / AMQP)](#channel-bindings-kafka--amqp)
  - [Security schemes](#security-schemes)
- [Document endpoints](#document-endpoints)
- [Migrating from v1.x](#migrating-from-v1x)
- [Live preview](#live-preview)
- [Contributing](#contributing)
- [License](#license)

## Features

- Decorate any controller / gateway / service method with `@AsyncApiSend` or `@AsyncApiReceive` and have it appear in the rendered document
- DTO introspection via `@nestjs/swagger`'s `@ApiProperty` decorator — same workflow as the HTTP side
- Outputs the AsyncAPI 3.0 document as **HTML, JSON, and YAML** from configurable routes
- Works with **Express** and **Fastify** HTTP adapters
- Supports **WebSocket gateways** (`@nestjs/websockets`) and **microservices** (`@nestjs/microservices`)
- Channel bindings for **Kafka** and **AMQP**
- Security schemes: bearer / OAuth2 / API key / basic / cookie / user-password

## Installation

```bash
npm install nestjs-asyncapi
```

The library bundles `@asyncapi/generator` (which depends on Puppeteer) but doesn't need Chromium for HTML rendering — the package ships with `puppeteer_skip_chromium_download` set, so a fresh install does **not** download Chromium.

### Peer dependencies

| Peer | Supported |
|---|---|
| `@nestjs/common` | `^9.0.0 \|\| ^10.0.0 \|\| ^11.0.0 \|\| ^12.0.0-0` |
| `@nestjs/core` | same |
| `@nestjs/swagger` | `^6.0.0 \|\| ^7.0.0 \|\| ^8.0.0 \|\| ^11.0.0` |
| `@nestjs/websockets` | same as `@nestjs/common` (optional) |

Node ≥ 20.0.0.

## Quick start

```typescript
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AsyncApiDocumentBuilder, AsyncApiModule } from 'nestjs-asyncapi';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const asyncApiOptions = new AsyncApiDocumentBuilder()
    .setTitle('Feline')
    .setDescription('Feline server description here')
    .setVersion('1.0')
    .setDefaultContentType('application/json')
    .addSecurity('user-password', { type: 'userPassword' })
    .addServer('feline-ws', {
      host: 'localhost:3000',
      protocol: 'socket.io',
    })
    .build();

  const asyncapiDocument = await AsyncApiModule.createDocument(app, asyncApiOptions);
  await AsyncApiModule.setup('/async-api', app, asyncapiDocument);

  await app.listen(3000);
}

bootstrap();
```

Decorate the methods that produce or consume messages:

```typescript
import { Controller } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { AsyncApiReceive, AsyncApiSend } from 'nestjs-asyncapi';

class CreateFelineDto {
  @ApiProperty()
  name: string;
}

@Controller()
class FelinesController {
  @AsyncApiSend({
    channel: 'create/feline',
    message: { payload: CreateFelineDto },
  })
  async createFeline() {
    // your logic
  }

  @AsyncApiReceive({
    channel: 'create/feline',
    message: { payload: CreateFelineDto },
  })
  async onFelineCreated() {
    // your logic
  }
}
```

`AsyncApiModule` automatically discovers `@Controller` and `@WebSocketGateway` classes. For other classes, decorate them with `@AsyncApiService()`.

## Usage

### Express vs Fastify

`AsyncApiModule.setup()` works against both adapters with no extra configuration:

```typescript
// Express
const app = await NestFactory.create<NestExpressApplication>(AppModule);

// Fastify
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter(),
);
```

### WebSocket gateways

`@SubscribeMessage()` methods on a `@WebSocketGateway()` class are picked up automatically. Mix `@AsyncApiSend` and `@AsyncApiReceive` to describe both directions of a duplex channel:

```typescript
import { MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { AsyncApiReceive, AsyncApiSend } from 'nestjs-asyncapi';

@WebSocketGateway({ namespace: 'ws' })
export class FelinesGateway {
  @WebSocketServer() server: Server;

  @SubscribeMessage('ws/create/feline')
  @AsyncApiSend({
    channel: 'ws/create/feline',
    message: { payload: CreateFelineDto },
  })
  async createFeline(@MessageBody() dto: CreateFelineDto) {
    // ...
    this.server.emit('ws/create/feline', new FelineRto(...));
  }

  // The reply path. `message` accepts an array for `oneOf` payloads.
  @AsyncApiReceive({
    channel: 'ws/create/feline',
    message: [
      { name: 'created',  payload: FelineRto },
      { name: 'extended', payload: FelineExtendedRto },
    ],
  })
  async emitCreatedFeline(rto: FelineRto) { /* ... */ }
}
```

### Microservices

For event-pattern handlers (`@nestjs/microservices`), decorate the same method with `@EventPattern` and `@AsyncApi*`:

```typescript
import { EventPattern } from '@nestjs/microservices';
import { AsyncApiReceive } from 'nestjs-asyncapi';

@Controller()
class FelinesController {
  @AsyncApiReceive({
    channel: 'ms/journal',
    message: { payload: JournalingDataDto },
  })
  @EventPattern('ms/journal')
  async journal(data: JournalingDataDto) {
    // ...
  }
}
```

### Channel bindings (Kafka / AMQP)

Pass `bindings` on the decorator to attach protocol-specific metadata. Types are exported from the package.

**Kafka:**

```typescript
@AsyncApiSend({
  channel: 'orders/created',
  message: { payload: OrderCreatedDto },
  bindings: {
    kafka: {
      groupId: { type: 'string', enum: ['orders-service'] },
      bindingVersion: '0.5.0',
    },
  },
})
async publishOrderCreated(order: OrderCreatedDto) { /* ... */ }
```

**AMQP:**

```typescript
@AsyncApiSend({
  channel: 'orders.created',
  message: { payload: OrderCreatedDto },
  bindings: {
    amqp: {
      ack: true,
      deliveryMode: 2,
      bindingVersion: '0.3.0',
    },
  },
})
async publishOrderCreated(order: OrderCreatedDto) { /* ... */ }
```

Channel-level bindings (topic / partitions / exchange / queue) and server-level bindings (Schema Registry URL etc.) can be set on `addServer()` and the document accordingly.

### Security schemes

The builder exposes per-scheme helpers:

```typescript
new AsyncApiDocumentBuilder()
  .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
  .addOAuth2({
    type: 'oauth2',
    flows: {
      clientCredentials: {
        tokenUrl: 'https://auth.example.com/token',
        scopes: { 'orders:read': 'Read orders' },
      },
    },
  })
  .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' })
  .addBasicAuth()
  .addCookieAuth('connect.sid')
  .addSecurity('user-password', { type: 'userPassword' })
  .addServer('orders', {
    host: 'broker.example.com:9092',
    protocol: 'kafka',
    security: [{ $ref: '#/components/securitySchemes/oauth2' }],
  });
```

Servers reference schemes via `$ref` to `components.securitySchemes` (the v3 form).

## Document endpoints

`AsyncApiModule.setup('/async-api', app, doc)` registers three routes:

| Path | Content |
|---|---|
| `/async-api` | Rendered HTML documentation page |
| `/async-api-json` | The AsyncAPI 3.0 document as JSON |
| `/async-api-yaml` | The AsyncAPI 3.0 document as YAML |

The base path (`/async-api`) is whatever you pass as the first argument to `setup()`.

## Migrating from v1.x

v2 targets the AsyncAPI 3.0 specification, which is a structural break from 2.x. Decorators are renamed (`@AsyncApiPub` → `@AsyncApiSend`, `@AsyncApiSub` → `@AsyncApiReceive`), server config moves from `url` to `host`, and operations are emitted as a top-level map referencing channels.

See **[docs/migration-v1-to-v2.md](docs/migration-v1-to-v2.md)** for the full diff and a sed-based codemod.

## Live preview

[![Live preview](https://img.shields.io/badge/preview-live-blue)](https://flamewow.github.io/nestjs-asyncapi/live-preview)

A pre-rendered AsyncAPI 3.0 document from the `sample/` app is published at <https://flamewow.github.io/nestjs-asyncapi/live-preview>. To run the sample locally:

```bash
git clone https://github.com/flamewow/nestjs-asyncapi.git
cd nestjs-asyncapi
npm install
npm run start:dev
# docs at http://0.0.0.0:4001/async-api
```

## Contributing

Bug reports, feature requests, and PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branch naming, commit conventions, and the PR process. Security issues should be reported via [SECURITY.md](SECURITY.md), not as public issues.

## License

[MIT](LICENSE) © Ilya Moroz

---

<h5>Do you use this library and like it? Don't be shy to give it a star
on <a href="https://github.com/flamewow/nestjs-asyncapi">github <span>★</span></a></h5>

