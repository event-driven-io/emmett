# Emmett Server HTTP Event Store API

Status: product and API specification  
Target: HTTP API v1; consumer subscriptions v1.1  
Contract formats: OpenAPI 3.1 for HTTP; AsyncAPI or an equivalent machine-readable contract for WebSocket subscriptions

## 1. Summary

Emmett Server exposes Emmett event stores through a language-neutral, resource-oriented API. Its first use is an Aspire-like operational Web UI, but the contract must also support remote applications written in other languages, containerized deployments, and future serverless/FaaS scenarios.

V1 provides finite event-store operations over HTTP:

- discover streams;
- test whether a stream exists;
- inspect stream metadata;
- read messages from a stream;
- append messages with optimistic concurrency;
- stream a finite historical range without buffering it in memory.

V1.1 adds live, consumer-backed subscriptions over a full-duplex WebSocket connection. This follows immediately after v1 because the required consumer primitive is optional in the current `EventStore` contract and backend capabilities vary.

Commands, queries, aggregate-state endpoints, GraphQL, gRPC, and FaaS hosting are planned extensions, not v1 requirements.

Normative terms such as MUST, SHOULD, and MAY have their RFC 2119 meanings.

## 2. Goals

1. Preserve Emmett event-store and processor semantics rather than inventing transport-specific behavior.
2. Provide a stable API suitable for both a Web UI and non-TypeScript clients.
3. Make the API discoverable through lightweight hypermedia without requiring clients to follow hypermedia.
4. Support safe writes through HTTP conditional requests and stream ETags.
5. Pass message data through without upcasting, downcasting, or type revival in the HTTP layer.
6. Work both as a secured standalone server, particularly in Docker, and as an API mounted into an existing application.
7. Keep handlers, authorization abstractions, route contracts, and OpenAPI generation framework-neutral so Express, Fastify, Hono, and future hosts can share the same application layer.
8. Advertise backend-dependent capabilities explicitly.
9. Establish extension points for application schemas, aggregates, commands, queries, GraphQL, gRPC, and FaaS.

## 3. Non-goals

V1 does not:

- transfer reducers, handlers, or other executable functions over HTTP;
- expose generic `aggregateStream` reducers;
- upcast or downcast stored messages;
- revive ISO strings into `Date` or decimal strings into `bigint`;
- emulate backward reads before Emmett supports them;
- require structured stream names;
- provide API-key administration over HTTP;
- act as an OAuth/OIDC identity provider;
- implement native ACME certificate management;
- define commercial pricing, license terms, or the free/premium feature boundary;
- provide competing consumers or manual acknowledgements;
- require consumers to use HAL or HAL-FORMS;
- promise that every event-store backend works on every JavaScript runtime.

## 4. Architecture

### 4.1 Layers

The implementation SHOULD have these separable layers:

1. **Contract model** — transport-neutral request, response, capability, principal, and permission types.
2. **Application handlers** — authorization, validation, event-store calls, error mapping, and observability.
3. **HTTP adapters** — routing, content negotiation, conditional headers, streaming, and integration with Hono, Express, Fastify, or another host framework.
4. **Standalone host** — configuration, CLI, authentication, TLS, lifecycle, and container packaging.
5. **Backend adapter** — the configured `EventStore` plus optional stream-catalog and message-source capabilities.

Hono hosts the first standalone implementation. Express, Fastify, and Hono may host the embedded API, but their framework types MUST NOT leak into the contract model or application handlers.

### 4.2 Deployment modes

- **Standalone server (v1):** first-class executable and container image with built-in API-key and OIDC authentication.
- **Embedded package (v1):** a host application mounts the same versioned endpoints at a configurable base path, supplies an `EventStore`, and either uses Emmett authentication or maps its existing authentication result to an Emmett normalized principal.

The standalone/API/UI code may live in a separate repository and use a separate license. Repository placement and license selection are outside this specification.

#### 4.2.1 Embedded-host contract

Embedding MUST be a supported composition mode, not a fork of the API implementation. The embedded entry point accepts at least:

- the configured `EventStore` and optional backend capabilities;
- a configurable mount path, defaulting to `/v1` when Emmett owns the application and allowing values such as `/emmett/v1` in an existing API;
- a principal resolver that maps the host framework's authenticated request context to Emmett's normalized principal, or an explicit choice to install Emmett's own authentication middleware;
- authorization, telemetry, error-reporting, and configuration hooks whose portable types are defined by the server core;
- an option controlling whether Emmett's OpenAPI and human-documentation routes are mounted.

The host retains ownership of server startup, shutdown, TLS, global middleware, trust-proxy policy, and its surrounding routes. Emmett retains ownership of its endpoint semantics, validation, authorization decisions, representations, and errors. A host authentication hook MUST NOT bypass Emmett authorization; it only supplies the principal and trusted authentication metadata used by the shared handlers.

V1 MUST provide idiomatic Hono, Express, and Fastify registration adapters. Adapters MUST register the same route contract and pass the same HTTP conformance suite. The adapter boundary MUST remain documented so another framework adapter can be implemented without copying or importing private handler logic.

### 4.3 Backend capability model

The active backend reports its supported capabilities. At minimum the root representation exposes booleans or typed capability resources for:

- stream reads;
- appends;
- stream existence;
- stream catalog/search;
- global positions;
- finite streaming reads;
- consumers/subscriptions;
- available subscription message sources;
- aggregate definitions registered by the host.

Unsupported optional operations MUST NOT be advertised through hypermedia controls. A direct request to a known but unsupported operation returns `501 Not Implemented` with Problem Details.

### 4.4 Technical implementation direction

The first implementation is **Node-first and Web-standards-based**, with Hono hosting the standalone server and Hono, Express, and Fastify adapters available for embedded use.

- Node.js 24 is the GA standalone runtime baseline.
- Hono supplies routing, middleware integration, and the Fetch-style HTTP boundary for the standalone host.
- Hono, Express, and Fastify are transport shells, not owners of event-store semantics.
- Framework-neutral application handlers own authorization, capability checks, ETags, pagination, message mapping, and error classification.
- Portable paths use standard `Request`, `Response`, `Headers`, `URL`, `AbortSignal`, Web Crypto, and Web Streams rather than Node-only equivalents.
- Runtime-specific entry points provide server startup, WebSocket upgrade, configuration, secrets, TLS, lifecycle, and observability integration.

Native Node APIs remain appropriate inside the Node host for HTTP/HTTP2, TLS, filesystem configuration, signals, process lifecycle, and development-certificate management. The API MUST NOT implement routing and representation behavior directly against `IncomingMessage`/`ServerResponse`, because that would make the Node host the application boundary.

#### 4.4.1 Package or export boundaries

The implementation SHOULD preserve these logical boundaries, whether shipped as individual packages or explicit subpath exports:

1. **Contract** — route descriptions, JSON Schema-compatible request/response definitions, HAL relations, Problem Details types, OpenAPI generation, and examples. It has no Hono or Node dependency.
2. **Server core** — event-store handlers, normalized principal/permissions, capabilities, pagination, conditional-write rules, finite streaming, and the subscription protocol state machine. It has no concrete web-server dependency.
3. **Framework adapter interface** — the public registration contract, request/principal mapping hooks, portable response/stream result, mount-path handling, and adapter conformance tests. It has no dependency on a specific framework.
4. **Hono adapter** — Hono route registration, validation integration, middleware, and conversion between Hono contexts and core handler inputs/outputs.
5. **Express adapter** — Express router registration and request, response, cancellation, and streaming integration without reimplementing endpoint behavior.
6. **Fastify adapter** — a Fastify plugin with prefix support and request, reply, schema, cancellation, and streaming integration without redefining the public contract.
7. **Node host** — `@hono/node-server`, WebSocket server adapter, CLI, Docker entry point, TLS, process signals, filesystem-backed configuration, and Node OpenTelemetry.
8. **Runtime adapters** — Bun, Deno, and Cloudflare entry points importing only their runtime-specific Hono/WebSocket/configuration dependencies.

Runtime-specific modules MUST use explicit exports/imports rather than top-level runtime detection. A Cloudflare bundle must not resolve Node-only modules such as `node:fs`, `node:http`, or the Node WebSocket server.

The portable Hono application factory, Express router registration, Fastify plugin, and Node `start` function MUST be separate exports or packages. Importing an embedded adapter MUST NOT start a listener or load CLI/TLS configuration. Existing Emmett framework packages may be reused, but the server package must not make `@hono/node-server` a dependency of an otherwise edge-portable or framework-neutral entry point.

#### 4.4.2 Runtime support matrix

| Runtime | Support objective | Hosting approach | Backend expectation |
|---|---|---|---|
| Node.js 24 | v1 GA baseline | Hono with `@hono/node-server`; Node lifecycle/TLS; `ws` for subscriptions | All backends that pass the server conformance suite |
| Bun | compatibility target | Hono/Bun fetch and WebSocket adapters | Certified individually; Node compatibility alone is insufficient |
| Deno | compatibility target | Hono/Deno and Deno's native server/upgrade APIs | Certified individually; permissions and native dependencies documented |
| Cloudflare Workers | specialized v1 finite-API target | Hono Worker fetch handler; platform TLS/configuration | D1 first; other drivers only after explicit certification |
| Cloudflare Durable Objects | specialized subscription target after Node subscriptions | Durable Object WebSocket ownership and coordination | Backend/source-specific certification |

The root capability representation reports runtime and backend capabilities; it does not imply support based only on the runtime name. Documentation maintains a tested runtime/backend matrix.

Cloudflare support is not implemented as a Node compatibility shim around the entire standalone server. It is a dedicated host adapter. Plain Workers may serve finite HTTP operations. Reliable coordinated long-lived subscriptions use Durable Objects or a later equivalent stateful platform primitive.

#### 4.4.3 HTTP streaming

Finite JSON-sequence reads use Web Streams:

- bridge the event-store `AsyncIterable` into `ReadableStream<Uint8Array>`;
- frame records with `TextEncoder` according to RFC 7464;
- propagate `AbortSignal` cancellation into the backend iterator;
- respect downstream demand and avoid unbounded buffering;
- keep `Buffer`, Node streams, and framework stream types outside the portable implementation.

The Node adapter may bridge between Web Streams and Node streams when required by its server implementation. HTTP/2 support is a host concern and MUST reuse the same portable response stream. The implementation must test direct HTTP/2 and/or the documented TLS proxy topology rather than assuming ordinary HTTP/1.1 WebSocket upgrade behavior applies to HTTP/2.

#### 4.4.4 WebSocket portability

The subscription protocol state machine depends on an internal duplex-channel abstraction rather than Hono, `ws`, Bun, Deno, or Cloudflare socket classes. The adapter exposes incoming frames, send, close, buffered/backpressure state, and lifecycle events.

- Node uses the Hono Node adapter with `ws` for server-side upgrades.
- Bun and Deno use their Hono/runtime WebSocket adapters.
- Cloudflare uses its WebSocket APIs and, for reliable coordinated subscriptions, Durable Objects.

Each adapter implements the same high/low-water buffering policy because WebSocket send/backpressure behavior differs by runtime. Protocol parsing, operation multiplexing, validation, identity conflicts, and processor lifecycle remain in the shared state machine.

#### 4.4.5 Portable security and observability

OIDC discovery and JWKS retrieval use `fetch`; cryptographic verification and API-key hashing use Web Crypto where supported. Runtime adapters supply secrets and normalized request connection information. Only the Node host manages direct TLS and development certificates; platform hosts such as Cloudflare terminate TLS themselves.

Core code uses explicit request/operation context and portable observability hooks. Node-specific AsyncLocalStorage, SDK initialization, exporters, and process instrumentation remain in the Node host. Other runtimes provide their own telemetry adapter without changing handler behavior.

## 5. Contract and compatibility

### 5.1 Source of truth

The TypeScript event-store/application definition is the logical domain source of truth. Framework-neutral route descriptors plus JSON Schema-compatible request and response definitions form the transport contract source. OpenAPI 3.1 is generated from them at build time and is the canonical published HTTP contract.

Hono route inference, Hono RPC types, or a particular validation library MUST NOT become the only source of the public contract. Generated `openapi.json` is validated, compatibility-checked, and packaged with the server build. Runtime validation reuses the same schemas or build-generated validators. Build output intended for runtimes that prohibit dynamic code generation MUST NOT require `eval` or `new Function`.

A future schema-aware DSL should use JSON Schema-compatible definitions and be capable of producing transport-specific contracts, including OpenAPI, AsyncAPI, GraphQL, and Protobuf where appropriate.

#### 5.1.1 Embedded OpenAPI composition

The contract package MUST export both the canonical standalone OpenAPI 3.1 document and a composition API that produces an embedded document for a configured mount path. Framework adapters MUST consume the shared route/schema registry; they MUST NOT maintain separate handwritten endpoint schemas.

The composition API MUST:

- rebase the canonical `/v1` root and every child path to the configured API root while retaining `v1` as the final version segment, for example `/v1` to `/emmett/v1`;
- namespace Emmett `operationId` values, component keys, tags, and security-scheme identifiers;
- rewrite internal references and server/path metadata consistently;
- detect and report path, operation, or component collisions rather than silently overwriting host definitions;
- support returning an Emmett-only document or merging Emmett operations and components into a host-provided OpenAPI 3.1 document;
- allow the host to supply or override deployment-specific `servers` and security declarations without changing endpoint schemas;
- produce the same effective contract that the selected framework adapter registers.

Adapters SHOULD expose their validation schemas to framework tooling where practical, but framework-generated OpenAPI is not canonical. The host decides whether and where to expose Swagger UI, Scalar, Redoc, or another documentation renderer. Emmett MUST NOT register a UI or overwrite an existing documentation route unless explicitly configured. When enabled, Emmett's `service-desc` link points to the effective standalone or composed OpenAPI location supplied by the host.

### 5.2 Versioning

- Major versions appear in the path: `/v1`, `/v2`, and so on.
- OpenAPI `info.version` uses semantic versioning for exact contract releases.
- Backward-compatible additions and corrections may ship within `/v1`.
- Breaking request, response, or behavioral changes require a new path major.
- Consecutive major versions run concurrently for a documented migration period.
- Deprecation uses the standard `Deprecation` and `Sunset` headers plus documentation links.
- Every breaking release includes both machine-readable change metadata and a human-readable migration guide with rationale, impact, and before/after examples.
- CI MUST compare the generated/published OpenAPI contract against the previous release and reject unapproved breaking changes.

## 6. HTTP conventions

### 6.1 Base URL, mount path, and resource names

The standalone API root is `/v1`. In embedded mode, the host MAY configure a different effective API root, for example `/emmett/v1`; the `v1` version segment remains part of Emmett's contract and MUST NOT be removed. All relative links, documentation links, OpenAPI paths, `Location` headers, and Problem Details `instance` values MUST use the effective API root. The canonical resources are `streams` and `messages`, reflecting that Emmett streams may contain event- or command-kind messages.

`{streamName}` represents one opaque stream name. Clients percent-encode it as a URI path segment. Routers and proxies MUST preserve encoded characters accurately, including names that contain delimiters. The server MUST NOT impose a naming convention in v1.

### 6.2 Media types

- `application/json`: straightforward JSON resources and collections.
- `application/hal+json`: the same resources with HAL links and HAL collection embedding.
- `application/prs.hal-forms+json`: optional actionable templates.
- `application/json-seq`: RFC 7464 finite streaming reads.
- `application/problem+json`: RFC 9457 errors.

If `Accept` is absent or `*/*`, the server returns `application/json`. Unsupported requested representations return `406 Not Acceptable`.

### 6.3 Hypermedia

HAL is optional for clients but mandatory for conforming servers when requested. Stable documented URLs remain supported.

The API root links to available top-level resources. Stream resources link to their messages collection. Collection resources include `self`, pagination links where applicable, and documentation/profile links. Custom relations use documented URI relations or a documented CURIE such as `emmett:*`.

HAL-FORMS MAY describe append and other permitted actions. Controls are authorization-aware: a viewer must not receive an append affordance.

Messages are not embedded in the stream metadata resource. In a HAL message collection, members appear under `_embedded.messages`; in ordinary JSON they appear under `messages`.

#### 6.3.1 Link-relation rules

HAL link keys are relation types, not endpoint names. Standard IANA relations are used where their semantics fit. Emmett-specific relations use the `emmett` CURIE:

```json
{
  "_links": {
    "curies": [
      {
        "name": "emmett",
        "href": "https://docs.emmett.dev/rels/{rel}",
        "templated": true
      }
    ]
  }
}
```

Dereferencing `https://docs.emmett.dev/rels/{rel}` MUST return human-readable relation documentation and SHOULD offer a machine-readable description through content negotiation.

Required relation vocabulary:

| Relation | Target and meaning |
|---|---|
| `self` | Canonical URL of the represented resource, including query parameters that define the current view |
| `service-desc` | OpenAPI 3.1 document for the current major API |
| `describedby` | Human-facing API or resource documentation |
| `profile` | Representation profile/schema documentation |
| `collection` | Collection containing the represented resource |
| `up` | Parent resource |
| `first`, `prev`, `next` | Cursor navigation for an ordered collection; omitted when unavailable |
| `emmett:streams` | Stream catalog |
| `emmett:stream` | Stream metadata resource associated with a message collection |
| `emmett:messages` | Canonical messages collection for a stream |
| `emmett:find` | Templated catalog search link |
| `emmett:subscriptions` | WebSocket subscription endpoint; advertised only when supported |
| `emmett:capabilities` | Detailed backend/server capability resource if split from the API root |
| `emmett:aggregates` | Registered aggregate-state entry point; advertised only when supported |

Each top-level HAL resource MUST contain `self`. Embedded resources SHOULD contain `self` when they have an individually addressable canonical resource; embedded recorded messages MAY omit it in v1 because v1 has no individual-message endpoint. Every HAL document using an `emmett:*` relation MUST include the `curies` declaration in that document. Top-level resources SHOULD contain `describedby` and `profile`. All links SHOULD include a `type` media-type hint when the target has a preferred representation. Links to unavailable backend capabilities MUST be omitted. Links to operations the authenticated principal cannot discover MUST be omitted.

Omitting a link is not the security boundary. A client calling a documented URL directly still receives the appropriate `401`, `403`, `404`, or `501` response.

HAL links describe navigable targets, normally using GET. Unsafe methods such as append MUST be described by HAL-FORMS templates rather than pretending a plain HAL link conveys an HTTP method.

#### 6.3.2 Required links by resource

| Represented resource | Required links | Conditional links/templates |
|---|---|---|
| API root | `self`, `service-desc`, `describedby`, `profile`, `emmett:streams` | `emmett:subscriptions`, `emmett:aggregates`, `emmett:capabilities` |
| Stream catalog | `self`, `first`, `emmett:find`, `up` | `prev`, `next` |
| Stream entry embedded in catalog | `self`, `collection`, `emmett:messages` | application-aware aggregate links |
| Stream metadata | `self`, `collection`, `up`, `emmett:messages` | application-aware aggregate links; append HAL-FORMS template |
| Message collection | `self`, `up`, `emmett:stream`, `first` | `prev`, `next`; append HAL-FORMS template |
| Recorded message embedded in collection | `up`, `emmett:stream` | `self` only if an individual-message endpoint is introduced later |
| Append result | `self` targeting the stream, `emmett:messages` | none |
| Problem Details | no HAL links required | standard `Link` response headers may point to help/documentation |

`first` for a message collection means the first forward page under the same filters and limit. V1 has no `last` link because the core store does not support backward reads efficiently. `prev` is supplied only when the backend/adapter can construct it without loading and reversing unbounded history.

#### 6.3.3 API-root HAL example

```json
{
  "apiVersion": "1",
  "contractVersion": "1.0.0",
  "serverVersion": "1.0.0",
  "capabilities": {
    "streamCatalog": true,
    "finiteStreaming": true,
    "subscriptions": false
  },
  "_links": {
    "self": { "href": "/v1", "type": "application/hal+json" },
    "service-desc": {
      "href": "/v1/openapi.json",
      "type": "application/vnd.oai.openapi+json;version=3.1"
    },
    "describedby": { "href": "/v1/docs", "type": "text/html" },
    "profile": {
      "href": "https://docs.emmett.dev/profiles/event-store-v1"
    },
    "emmett:streams": {
      "href": "/v1/streams",
      "type": "application/hal+json"
    },
    "curies": [
      {
        "name": "emmett",
        "href": "https://docs.emmett.dev/rels/{rel}",
        "templated": true
      }
    ]
  }
}
```

When subscriptions become available, the root adds a link such as:

```json
{
  "emmett:subscriptions": {
    "href": "/v1/subscriptions",
    "title": "Open a multiplexed consumer WebSocket"
  }
}
```

The URI remains `https` in an HTTPS deployment; the WebSocket client derives `wss` during upgrade. Documentation MUST NOT require clients to perform an ordinary GET expecting a JSON representation from this link.

#### 6.3.4 Stream and messages HAL examples

Stream metadata:

```json
{
  "streamName": "order:order-123",
  "currentStreamVersion": "42",
  "_links": {
    "self": {
      "href": "/v1/streams/order%3Aorder-123",
      "type": "application/hal+json"
    },
    "collection": { "href": "/v1/streams" },
    "up": { "href": "/v1" },
    "emmett:messages": {
      "href": "/v1/streams/order%3Aorder-123/messages{?from,to,limit}",
      "templated": true,
      "type": "application/hal+json"
    },
    "curies": [
      {
        "name": "emmett",
        "href": "https://docs.emmett.dev/rels/{rel}",
        "templated": true
      }
    ]
  }
}
```

Message collection:

```json
{
  "streamName": "order:order-123",
  "currentStreamVersion": "42",
  "_embedded": {
    "messages": []
  },
  "_links": {
    "self": {
      "href": "/v1/streams/order%3Aorder-123/messages?from=0&limit=100"
    },
    "first": {
      "href": "/v1/streams/order%3Aorder-123/messages?from=0&limit=100"
    },
    "next": {
      "href": "/v1/streams/order%3Aorder-123/messages?from=100&limit=100"
    },
    "up": { "href": "/v1/streams/order%3Aorder-123" },
    "emmett:stream": { "href": "/v1/streams/order%3Aorder-123" },
    "curies": [
      {
        "name": "emmett",
        "href": "https://docs.emmett.dev/rels/{rel}",
        "templated": true
      }
    ]
  }
}
```

The example positions are illustrative. The actual `next` target starts after the last returned message according to Emmett's forward-read semantics and MUST not skip or repeat a message within an unchanged stream snapshot.

#### 6.3.5 Append HAL-FORMS template

For an authorized editor/admin requesting `application/prs.hal-forms+json`, a stream or message collection exposes append as a template:

```json
{
  "_templates": {
    "append": {
      "title": "Append messages",
      "method": "POST",
      "target": "/v1/streams/order%3Aorder-123/messages",
      "contentType": "application/json",
      "properties": [
        {
          "name": "messages",
          "required": true,
          "type": "array"
        }
      ]
    }
  }
}
```

Optimistic concurrency remains expressed with `If-Match` or `If-None-Match`. Because HAL-FORMS property templates do not fully describe conditional HTTP headers, the template MUST link through its profile/documentation to the concurrency rules. The OpenAPI operation remains the complete machine-readable request definition.

### 6.4 JSON values

- Message `data` and user metadata MUST be JSON-compatible at the transport boundary.
- Dates are ISO 8601 strings.
- `bigint`, stream positions, global positions, and processor checkpoints are decimal strings.
- The HTTP layer does not infer or revive runtime types.
- The HTTP layer does not perform schema upcasting or downcasting.
- Property names and values are passed through unless validation against an explicitly registered application schema is enabled in a later extension.

## 7. Message representations

### 7.1 Append message

```json
{
  "kind": "Event",
  "type": "OrderPlaced",
  "data": {
    "orderId": "order-123"
  },
  "metadata": {
    "correlationId": "correlation-123"
  }
}
```

Rules:

- `type` is a required non-empty string.
- `data` is a required JSON object, matching Emmett's message contract.
- `kind` is `Event` or `Command`; omission defaults to `Event` for compatibility.
- `metadata` is optional and follows the configured event-store behavior.
- Server-produced recording values such as `streamName`, `streamPosition`, and `globalPosition` cannot be authoritatively assigned by an append request. Existing Emmett/backend behavior determines collision handling; conformance tests document it.

### 7.2 Recorded message

The read representation preserves Emmett's combined metadata shape:

```json
{
  "kind": "Event",
  "type": "OrderPlaced",
  "data": {
    "orderId": "order-123"
  },
  "metadata": {
    "messageId": "019...",
    "streamName": "order:order-123",
    "streamPosition": "42",
    "globalPosition": "9876",
    "checkpoint": "9876",
    "correlationId": "correlation-123"
  }
}
```

`globalPosition` and `checkpoint` are present only when supported and returned by the backend. The transport does not create a second system/user metadata envelope.

## 8. HTTP resources

### 8.0 Endpoint inventory

The following paths are the stable, directly usable v1 endpoints. Hypermedia advertises the subset supported by the configured backend and authorized for the current principal.

Paths in this table use the standalone `/v1` root. Embedded adapters replace that root with their configured effective API root as defined in section 6.1.

| Method | Path | Purpose | Success |
|---|---|---|---:|
| `GET` | `/v1` | API root, versions, capabilities, and entry-point links | 200 |
| `GET` | `/v1/openapi.json` | Exact OpenAPI 3.1 contract served by this API build | 200 |
| `GET` | `/v1/docs` | Human-facing API documentation | 200 |
| `GET` | `/v1/streams` | Paginated/searchable stream catalog | 200 |
| `GET` | `/v1/streams/{streamName}` | Stream metadata and links | 200 |
| `HEAD` | `/v1/streams/{streamName}` | Stream existence and current ETag | 200 |
| `GET` | `/v1/streams/{streamName}/messages` | Forward finite read as JSON, HAL, or JSON sequence | 200 |
| `POST` | `/v1/streams/{streamName}/messages` | Append one or more messages | 200/201 |
| `GET` upgrade | `/v1/subscriptions` | Multiplexed WebSocket subscriptions, when v1.1 is supported | 101 |

Servers MAY redirect `/v1/docs` to a version-matched documentation location, but `/v1/openapi.json` MUST remain directly retrievable without a redirect. Both endpoints follow the API's read authorization policy; deployments MAY make documentation public without making event data public.

### 8.1 API root

`GET /v1`

Returns API version, server version, advertised capabilities, and links to streams, OpenAPI, authentication metadata where safe, and future resources.

Example JSON:

```json
{
  "apiVersion": "1",
  "contractVersion": "1.0.0",
  "serverVersion": "1.0.0",
  "capabilities": {
    "streamCatalog": true,
    "globalPosition": true,
    "finiteStreaming": true,
    "subscriptions": false
  }
}
```

The response MUST NOT expose raw API keys, OAuth tokens, license material, or sensitive configuration.

### 8.2 Stream catalog

`GET /v1/streams`

Provides the operational stream catalog required by the Web UI. This is an extension beyond the current base `EventStore` interface and requires a catalog-capable backend adapter.

Query parameters:

- `limit`: positive integer; default `100`, configured maximum `1000`.
- `cursor`: opaque continuation token returned by the server.
- `q`: backend-supported text search over stream names.
- `streamType`: optional structured stream-type filter when an identity codec recognizes it.

The cursor is opaque, stable only for its documented lifetime, and MUST NOT be parsed by clients. Results contain stream name, current version when efficiently available, optional structured identity, and resource links. HAL uses `_embedded.streams` and `next`; JSON uses `streams` and `nextCursor`.

Catalog ordering MUST be deterministic for a given backend. The exact ordering and search semantics are declared in capability metadata and OpenAPI descriptions.

### 8.3 Stream metadata and existence

`GET /v1/streams/{streamName}`

Returns stream metadata and links, but not messages. A successful response includes a strong ETag whose opaque value is the current stream version.

```json
{
  "streamName": "order:order-123",
  "currentStreamVersion": "42",
  "identity": {
    "streamType": "order",
    "streamId": "order-123"
  }
}
```

`identity` is omitted when no configured codec recognizes the name. Failure to parse a structured identity is not an error.

`HEAD /v1/streams/{streamName}`

Maps directly to `streamExists`. It returns `200 OK` and the current ETag when the stream exists, or `404 Not Found` when it does not. It returns no body.

Both GET and HEAD return `404` for a missing stream.

### 8.4 Read stream messages

`GET /v1/streams/{streamName}/messages`

Query parameters map to current forward `readStream` behavior:

- `from`: inclusive stream position as a decimal string; defaults to the backend/core beginning.
- `to`: inclusive upper position as a decimal string.
- `limit`: maximum number of messages; default `100`, configured maximum `1000` for JSON and HAL.

Invalid ranges or positions return `400 Bad Request`. V1 does not provide newest-first or backward reads.

A successful JSON response contains:

```json
{
  "streamName": "order:order-123",
  "currentStreamVersion": "42",
  "messages": []
}
```

The response includes the stream's current strong ETag. Pagination links/cursors identify the next forward position when more messages exist. A missing stream returns `404`, not an empty successful collection.

Conditional GET MAY support `If-None-Match`; a matching current ETag returns `304 Not Modified`.

#### Finite streaming representation

With `Accept: application/json-seq`, the same endpoint streams the selected historical range as an RFC 7464 JSON Text Sequence and then closes.

- Each record is one complete recorded-message representation.
- There is no message-count hard limit unless the caller supplies `to` or `limit`.
- The server processes incrementally, honors transport backpressure, and does not buffer the entire result.
- Client cancellation promptly cancels the backend read and releases resources.
- It works over HTTP/2 and streaming-capable HTTP/1.1.
- It is finite. Live following belongs to subscriptions, not this endpoint.
- The initial response headers include the current stream ETag. Per-record changes do not alter it.

### 8.5 Append messages

`POST /v1/streams/{streamName}/messages`

Request body:

```json
{
  "messages": [
    {
      "kind": "Event",
      "type": "OrderPlaced",
      "data": { "orderId": "order-123" },
      "metadata": {}
    }
  ]
}
```

The `messages` array MUST contain at least one item. The configured server limit bounds batch count and total body bytes and returns `413 Content Too Large` when exceeded.

Optimistic concurrency maps to standard conditional headers:

| Emmett expectation | HTTP request |
|---|---|
| exact version `42` | `If-Match: "42"` |
| `STREAM_EXISTS` | `If-Match: *` |
| `STREAM_DOES_NOT_EXIST` | `If-None-Match: *` |
| `NO_CONCURRENCY_CHECK` | omit both headers |

Rules:

- Contradictory `If-Match` and `If-None-Match` headers return `400`.
- Weak ETags, lists of tags, and malformed stream-version tags return `400` in v1.
- A failed expectation returns `412 Precondition Failed` and includes the current ETag when available.
- Omitted condition headers remain valid and map to `NO_CONCURRENCY_CHECK`.

Success returns `201 Created` when a new stream was created and `200 OK` when appending to an existing stream. The response includes the new strong ETag and:

```json
{
  "streamName": "order:order-123",
  "nextExpectedStreamVersion": "43",
  "createdNewStream": false,
  "lastEventGlobalPosition": "9877"
}
```

`lastEventGlobalPosition` is omitted when the backend does not provide it. The `Location` header points to the stream resource.

## 9. Errors

All non-empty HTTP error responses use RFC 9457 `application/problem+json`:

```json
{
  "type": "https://docs.emmett.dev/problems/expected-stream-version",
  "title": "Expected stream version did not match",
  "status": 412,
  "detail": "Expected version 41; current version is 42.",
  "instance": "/v1/streams/order%3Aorder-123/messages",
  "code": "EXPECTED_STREAM_VERSION_MISMATCH",
  "traceId": "..."
}
```

Required mappings include:

| Condition | Status |
|---|---:|
| malformed input, cursor, range, or conditional header | 400 |
| missing/invalid credentials | 401 |
| authenticated but unauthorized | 403 |
| stream/resource not found | 404 |
| unacceptable response media type | 406 |
| processor/checkpoint identity already active | 409 |
| optimistic concurrency failure | 412 |
| request or append batch too large | 413 |
| unsupported request media type | 415 |
| rate limit exceeded | 429 |
| backend capability not implemented | 501 |
| unavailable backend | 503 |

Problems use stable type URIs and machine-readable `code` values. Internal stack traces, secrets, raw license data, and backend connection details MUST NOT be returned.

## 10. Security

### 10.1 Authentication modes

Standalone v1 supports exactly these configured modes:

- `api-key`;
- `oidc` access-token validation against configurable external issuers;
- explicit `insecure` mode.

Secure operation is the default. If no credential is configured for local startup, the CLI generates a strong one-time API key and displays it once. Keys are stored only as secrets/secure hashes as appropriate.

The Web UI uses OIDC Authorization Code with PKCE. Machine clients use API keys or suitable OAuth machine credentials. Emmett Server is not an identity provider and stores no local passwords.

Insecure mode requires explicit configuration and emits prominent startup/runtime warnings. Plain unauthenticated external binding requires a separate explicit override. Plain HTTP on loopback is allowed for development.

### 10.2 Authorization

Authentication produces a normalized principal. Roles resolve to permissions, and handlers authorize permissions rather than checking role names.

Initial roles:

| Role | Baseline permissions |
|---|---|
| `viewer` | API discovery, stream list/read/existence, subscription read where enabled |
| `editor` | all viewer permissions plus append |
| `admin` | all editor permissions plus server/consumer administration exposed by the version |

The internal authorization call receives principal, operation, stream name, parsed stream identity, message types when known, and deployment context. This enables later policies for stream type/name patterns, tenants, message types, and resource ownership without changing endpoint shapes.

API keys and OIDC claims map to roles/permissions through configuration. Unauthorized hypermedia actions are omitted, but direct unauthorized calls still return `403`.

### 10.3 API-key lifecycle

V1 manages API keys through CLI/configuration/secrets, not HTTP. CLI operations cover creation, safe metadata listing, rotation, and revocation. Secrets are never printed again after initial generation.

### 10.4 TLS

Supported deployment patterns:

- direct HTTPS with configured certificate/private-key files;
- TLS termination behind an explicitly trusted reverse proxy;
- local development HTTPS using generated/reused development certificates;
- plain loopback HTTP for development.

CLI design:

- `emmett serve --https` creates or reuses a development certificate;
- `emmett certs trust` changes the trust store only with explicit consent;
- `emmett certs check`, `export`, and `clean` manage lifecycle;
- use `mkcert` when already available, but never silently download executables or modify trust stores;
- allow explicit certificate, key, and CA paths.

Production documentation includes a first-class Caddy/Let's Encrypt recipe. Native ACME lifecycle management is deferred.

Trusted-proxy configuration MUST be explicit and bounded; forwarded identity or scheme headers from untrusted peers are ignored.

## 11. Structured stream identity

Stream names remain opaque and unrestricted by v1. An optional codec may parse and format structured identities. Emmett's existing `type:id` convention is an available/default codec where suitable.

- Parsing success adds optional `streamType` and `streamId` metadata.
- Parsing failure means “unstructured,” not invalid.
- Deployments may configure a custom codec.
- Enforcement is not part of v1.
- Later opt-in enforcement must not change the representation of already valid streams.

## 12. Consumer subscriptions (v1.1)

This section defines the intended contract boundary. Its final frame schema MUST be published in a machine-readable asynchronous API contract before implementation is declared stable.

### 12.1 Transport and endpoint

Subscriptions use one full-duplex WebSocket connection, for example:

`GET /v1/subscriptions`

The client requests the registered Emmett WebSocket subprotocol during the upgrade. Authentication uses the same normalized security model as HTTP. Browser-compatible token transport must avoid credentials in URLs where practical and must never log tokens.

Finite history remains under `/streams/{streamName}/messages`; the messages endpoint has no `follow` parameter.

### 12.2 Multiplexing

One socket supports multiple concurrent logical subscriptions.

- The client chooses an operation `id` unique among currently active operations on that socket.
- Every operation-scoped frame includes `id`.
- Deliveries for different operations may be interleaved fairly.
- Normal completion or an operation error affects only that operation.
- Authentication failure, malformed framing, or an unrecoverable protocol violation may close the entire socket.
- Closing the socket stops and cleans up all its active operations.
- Configurable limits bound connections per principal, operations per connection, message/frame size, and buffered/in-flight deliveries.

Connection-level frames follow established conventions: initialize/ready, ping/pong, and fatal error. Operation-level frames include subscribe, subscribed/ready, message, caught-up, complete, and error. V1.1 uses automatic acknowledgement only; it has no `ack`, `nack`, or separate acknowledgement HTTP endpoint. If manual acknowledgement is added later, it must use frames on this same socket.

### 12.3 Processor semantics

Subscriptions adapt Emmett consumers/processors; they do not create a separate checkpoint model.

Each subscribe operation supplies:

- connection-local operation `id`;
- required stable `processorId`;
- optional `processorInstanceId` where the backend/core exposes it;
- optional `version` and `partition` following processor behavior;
- checkpoint configuration, including explicit `"DISABLED"`;
- optional `startFrom`;
- one message source selected from those advertised by the backend;
- source/filter parameters supported by that source.

Official SDKs may generate a processor ID as an explicit convenience, but it is always present on the wire and in logs, metrics, traces, and administrative status.

`startFrom` uses the exact processor vocabulary:

```json
"BEGINNING"
```

```json
"END"
```

```json
{ "lastCheckpoint": "42" }
```

An explicit `startFrom` overrides a stored checkpoint. When omitted and checkpointing is enabled, the processor resumes after its stored checkpoint; if none exists, it starts at `BEGINNING`. With checkpoints disabled, no progress is persisted. Checkpoint comparison and storage behavior delegate to Emmett.

V1.1 permits only one active operation per checkpoint identity (`processorId` plus optional `partition`) within a server instance. A conflict produces an operation-level `409`-equivalent error and leaves the socket open. Competing consumers are deferred.

The configured backend advertises available message sources. The WebSocket contract does not assume every backend provides a global source, per-stream source, or identical filtering.

### 12.4 Automatic acknowledgement boundary

V1.1 exposes only the automatic behavior provided by the consumer/processor integration. The implementation and documentation MUST state precisely when the processor handler is considered successful and its checkpoint is stored. It MUST NOT claim exactly-once delivery. Stronger manual acknowledgement and redelivery semantics require a later explicit design.

## 13. Aggregate and application-aware extension

Generic clients can reconstruct state by reading messages. The server MUST NOT accept reducer code over the network.

After v1, applications may register named aggregate definitions in the server. Registered definitions may expose a state resource such as:

`GET /v1/aggregates/{aggregateType}/{aggregateId}`

The registry supplies the reducer, initial state, schemas, authorization context, and stream mapping. Only registered definitions are callable. The final endpoint and schema require a separate specification.

The same application-definition layer may later expose commands, queries, GraphQL fields, and gRPC services.

## 14. Licensing architecture

Commercial policy is outside this specification. The implementation provides a replaceable entitlement-provider interface returning capabilities to the application layer.

Technical requirements before GA:

- support offline-first cryptographically signed license documents;
- accept license content from a secret-backed environment variable or file;
- include license ID, issuer/customer metadata, validity, format version, entitlements, and optional limits;
- avoid machine/hardware binding;
- provide CLI inspection/validation without revealing raw material;
- never expose raw licenses in HTTP, browser bundles, logs, telemetry, or OpenAPI;
- provide advance expiry warnings and an optional grace-period mechanism;
- never make existing event data unreadable or unexportable because of license state.

Free/premium boundaries, expiry enforcement, delegated leases, and optional online activation are separate product decisions.

## 15. Observability and operations

Every request and subscription operation emits structured telemetry containing safe versions of:

- trace/request ID;
- authenticated principal ID and auth mechanism, excluding credentials;
- operation name and outcome;
- stream name and parsed type where policy permits;
- processor ID, instance ID, and partition for subscriptions;
- start/current positions and counts;
- duration, bytes, and cancellation reason;
- backend and capability identifiers;
- stable error code.

OpenTelemetry-compatible traces and metrics are preferred. High-cardinality labels such as arbitrary stream names or processor IDs MUST be configurable and SHOULD not be metric dimensions by default. Logs must redact authorization headers, API keys, cookies, license material, and sensitive event payloads.

Health endpoints distinguish liveness from readiness. Readiness checks the configured backend without performing destructive writes. Operational limits and active subscription counts are inspectable by authorized administrators.

## 16. Configuration

Configuration sources follow a documented precedence such as CLI arguments over environment variables over configuration files over defaults. All settings have stable names and validation errors fail startup clearly.

Configurable limits include:

- bind address and trusted proxies;
- request/header/body size;
- append batch count;
- JSON/HAL page default and maximum;
- request and idle timeouts;
- concurrent finite streams;
- WebSocket connections and operations;
- WebSocket frame and buffer sizes;
- rate limits;
- CORS origins for browser deployments;
- backend-specific catalog/search behavior.

Container shutdown stops accepting new work, allows a configurable drain period, cancels remaining streams/subscriptions, closes the event store, and exits predictably.

## 17. Conformance and testing

The project MUST provide a backend conformance suite covering:

1. missing/existing stream behavior;
2. forward read bounds and limits;
3. append ordering and atomicity as guaranteed by the backend;
4. all four expected-version mappings;
5. ETag values before and after append;
6. message metadata fidelity and backend-specific optional fields;
7. opaque and structured stream names;
8. JSON/HAL equivalence;
9. RFC 7464 framing, backpressure, and cancellation;
10. catalog cursor determinism and invalidation behavior;
11. authentication and permission boundaries;
12. Problem Details mappings;
13. capability advertisement and unsupported operations.

The v1.1 suite additionally covers multiplexing, duplicate operation IDs, duplicate checkpoint identities, start-position precedence, checkpoint disabled/enabled behavior, caught-up signaling, fair delivery, operation-scoped failures, socket cleanup, heartbeats, limits, and reconnection.

Contract tests validate examples against OpenAPI/AsyncAPI schemas. Security tests cover secret redaction, authorization bypass attempts, encoded stream names, proxy-header spoofing, oversized frames/bodies, slow readers, and resource exhaustion.

The HTTP conformance suite MUST be host-independent and runnable against the Hono, Express, and Fastify embedded adapters as well as Node, Bun, Deno, and Miniflare/Cloudflare runtime adapters where applicable. It MUST test the default and a non-default mount path, host-principal mapping, inherited middleware, relative link generation, and OpenAPI composition/collision handling. Passing core unit tests is not sufficient to claim runtime or framework support. A runtime/backend pair is documented as supported only after its integration suite passes continuously in CI. Tests specifically cover streaming cancellation/backpressure, runtime-specific URL decoding, Web Crypto behavior, dependency bundling, and absence of forbidden Node imports in edge builds.

### 17.1 Implementation sequence

Recommended delivery order:

1. Framework-neutral contract registry, schemas, core handlers, adapter interface, and unit tests.
2. Hono route adapter and Node standalone host.
3. Build-time OpenAPI 3.1 generation, mount-path rebasing, composition, examples, and compatibility checks.
4. Express and Fastify embedded adapters running the same HTTP conformance suite.
5. Backend capability/catalog adapters and the Node backend conformance matrix.
6. RFC 7464 finite streaming through Web Streams across all v1 framework adapters.
7. Node WebSocket adapter and shared subscription state machine for v1.1.
8. Bun and Deno host adapters running the same HTTP conformance suite.
9. Cloudflare+D1 finite API with Miniflare and deployed smoke tests.
10. Cloudflare Durable Object subscription hosting as a distinct, capability-gated extension.

## 18. Deliverables and acceptance criteria

### V1

- Published OpenAPI 3.1 document and human documentation.
- Build-time OpenAPI generation from framework-neutral route/schema definitions.
- Framework-neutral contract and handler packages/exports.
- Public framework-adapter interface and conformance kit.
- Hono, Express, and Fastify HTTP adapters with configurable mount paths and host-principal mapping.
- OpenAPI path rebasing, collision-safe host-document composition, and opt-in documentation-route mounting.
- Node 24 standalone host and container image.
- API root/capabilities.
- Stream catalog.
- GET/HEAD stream resource.
- Paginated JSON and HAL forward message reads.
- Finite RFC 7464 streaming reads.
- Batch append with ETag concurrency.
- RFC 9457 errors.
- API-key, OIDC, and explicit insecure modes.
- Viewer/editor/admin authorization foundation.
- TLS/dev-certificate tooling and reverse-proxy guidance.
- CLI-managed API keys.
- Backend conformance suite and compatibility checks.
- Published tested runtime/backend support matrix.

V1 is accepted when a non-TypeScript client can discover, list, inspect, read, stream finite history, and append to a supported Emmett backend with documented concurrency and security behavior. The same behavior and effective OpenAPI contract must pass conformance tests when the API is standalone and when mounted at a non-default API root in Hono, Express, and Fastify applications using host-provided authentication.

### V1.1

- Published machine-readable WebSocket contract.
- Full-duplex multiplexed consumer subscriptions.
- Backend-advertised sources.
- Required processor identities.
- Processor-compatible start positions and checkpoints, including `DISABLED`.
- Auto mode only, with its checkpoint boundary documented.
- Limits, fairness, heartbeat, cancellation, and observability.

## 19. Deferred decisions

These are intentionally not blockers for v1 implementation:

- exact JSON Schema-compatible runtime validation library;
- final DSL and JSON Schema registration model;
- aggregate-state endpoint shape;
- command/query APIs;
- GraphQL, gRPC, and FaaS contracts;
- backward reads after core Emmett supports them;
- native ACME automation;
- adapters for frameworks other than the v1 Hono, Express, and Fastify set;
- structured stream-name enforcement;
- API-key administration endpoints;
- competing consumers;
- manual acknowledgement/redelivery modes;
- exact free/premium entitlements and commercial license policy;
- whether v1.1 subscription resources also receive an administrative HTTP projection;
- GA support timing for each Bun, Deno, and non-D1 Cloudflare backend combination.

## 20. Standards and design references

- OpenAPI 3.1
- JSON Schema 2020-12
- RFC 9110 HTTP Semantics
- RFC 9457 Problem Details for HTTP APIs
- RFC 7464 JSON Text Sequences
- HAL and HAL-FORMS
- RFC 8594 Sunset header and the Deprecation header specification
- OpenID Connect and OAuth 2.0 Authorization Code with PKCE
- `graphql-transport-ws`, STOMP 1.2, NATS, and RSocket as subscription-protocol design references
