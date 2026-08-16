# HTTP Event Store API — Discovery Q&A

## 1. Initial API scope

**Question:** Should the first HTTP API be a generic, event-store-level API exposing raw stream operations (`readStream`, `appendToStream`, and `streamExists`), or an application-specific API exposing domain commands and views?

**Answer:** Start with access to the event store through HTTP. Commands and queries may be added later.

**Decision:** Version one will define a generic HTTP façade over event-store operations. The design should leave room for future command and query APIs without including them in the initial scope.

## 2. Primary consumer and longer-term direction

**Question:** Who is the primary intended consumer of version one: a trusted administrative Web UI for inspecting and editing event streams, application services using the event store remotely, or both?

**Answer:** The initial consumer is an Aspire-like Web UI. The API may need additional methods to make that UI useful, although the starting point remains event-store access over HTTP. Longer term, it could also let clients in other programming languages use Emmett through Docker as an “Emmett Server,” and eventually support FaaS scenarios.

**Decision:** Optimize the initial API for an operational Web UI, while defining a language-neutral network contract suitable for future remote application clients. Treat a standalone/containerized Emmett Server and FaaS support as future architectural directions. Identify UI-oriented operations that are not currently present on the core `EventStore` interface instead of limiting the HTTP design mechanically to that interface.

## 3. Version-one read/write scope

**Question:** Should version one permit writes—specifically appending events with optimistic concurrency—or should the initial operational UI and HTTP API be read-only?

**Answer:** It should expose all methods provided by the event store. Consumer support can come after v1, but should follow immediately.

**Decision:** Version one is not read-only. It will include the remotely meaningful core operations `readStream`, `appendToStream`, and `streamExists`, including optimistic concurrency behavior. Consumer/subscription functionality is the first planned capability after v1. The treatment of `aggregateStream` remains to be decided because its required executable reducer functions cannot be transferred directly in a language-neutral HTTP request.

## 4. Aggregate state over HTTP

**Question:** How should `aggregateStream` be handled: exclude it from the HTTP API and let clients fold events locally, or support server-registered aggregate definitions referenced by name?

**Answer:** Both approaches are useful. Clients can read a stream and reconstruct state themselves, but once the server knows the application structure, it could and should expose the reconstructed state.

**Decision:** The baseline generic API will expose raw stream reads, allowing clients to fold events locally. Do not attempt to send reducer functions over HTTP. Add an application-aware extension in which aggregates registered on the server can expose their current reconstructed state through a stable identifier. The exact registration model and endpoint belong to a later design stage or post-v1 scope unless required by the Web UI.

## 5. Canonical API definition format

**Question:** Should OpenAPI 3.1 be the canonical, implementation-independent API contract from which documentation and client SDKs can be generated?

**Answer:** Probably; clarification was requested about the alternatives.

**Follow-up answer:** Supporting commands, queries, and aggregate state will likely require a DSL with JSON Schema support. The logical source of truth should be the TypeScript event-store/application definition, while each API format has different requirements. OpenAPI 3.1 is appropriate for the HTTP API, and AsyncAPI and GraphQL should also be supported. Whether OpenAPI is generated from the TypeScript/DSL model or authored schema-first should remain open for now.

**Decision:** Use OpenAPI 3.1 as the contract format for the HTTP API, but do not yet decide whether it is hand-authored or generated. Treat the TypeScript application/event-store definition as the logical domain source of truth. Plan for a schema-aware DSL, likely using JSON Schema-compatible definitions, from which transport-specific representations may be derived. AsyncAPI, GraphQL, and potentially gRPC/Protobuf are complementary contracts rather than replacements for OpenAPI.

## 6. HTTP API style

**Question:** For the initial HTTP contract, do you prefer resource-oriented endpoints such as `GET/POST /v1/streams/{streamName}`, or operation-oriented endpoints such as `POST /v1/read-stream` and `POST /v1/append-to-stream`?

**Answer:** Use a resource-oriented HTTP API. It should be RESTful in the hypermedia sense, ideally with a lightweight HATEOAS approach. Hypermedia should drive navigation and available operations, but clients must not be required to use it.

**Decision:** Model streams, events, and future application concepts as HTTP resources with standard methods. Include optional hypermedia controls so discoverable clients such as the Web UI can navigate the API and determine available actions. Maintain stable, documented URLs and semantics for clients that do not follow hypermedia.

## 7. Hypermedia representation strategy

**Question:** Should the API use an established hypermedia format such as HAL, or define a lightweight Emmett convention—likely `_links` plus optional `_actions`—within ordinary JSON responses?

**Answer:** An established format is preferred.

**Decision:** Adopt an established hypermedia media type rather than inventing an Emmett-specific link/action vocabulary. The particular format remains to be selected.

## 8. Hypermedia format selection criterion

**Question:** Which standard should we target: HAL with HAL-FORMS for write affordances, or Siren, which natively models links, embedded entities, and actions in one format? The initial recommendation was HAL/HAL-FORMS because its simpler representations and broad tooling fit an operational API well.

**Answer:** Prefer whichever option has greater adoption and better tooling availability.

**Research outcome:** HAL has the stronger adoption and tooling case. It has an IANA-registered media type and first-class support in major ecosystems such as Spring. HAL-FORMS adds write-action templates and supporting browser/tool integrations. Siren provides JavaScript client/server libraries and an API browser, but has a smaller ecosystem.

**Follow-up question:** Should the API adopt HAL as the default representation and optionally serve HAL-FORMS when a client requests discoverable write actions?

**Follow-up answer:** Yes.

**Decision:** Use HAL as the standard hypermedia representation. Provide HAL-FORMS through content negotiation when clients request actionable controls. Clients may instead use documented URLs and ordinary request payloads without interpreting either hypermedia format.

## 9. Stream discovery

**Question:** Must v1 include a paginated, searchable stream catalog—such as `GET /v1/streams`—even though listing streams is not currently part of the core `EventStore` interface?

**Answer:** Yes, it can be included, and its exposure should be designed carefully. The use of `v1` also raises the need for an explicit versioning strategy.

**Decision:** Include stream discovery in v1 as a Web-UI-oriented extension to the existing `EventStore` interface. It will be a resource-oriented, paginated collection with search/filter behavior to be specified. Define an API versioning and compatibility policy before finalizing endpoint paths.

## 10. API versioning strategy

**Question:** Should major API versions appear in the URL (`/v1/...`), with backward-compatible additive changes allowed within v1 and breaking changes reserved for `/v2`?

**Answer:** Research the most common and best-recommended API versioning strategies, including date-based approaches such as Microsoft's. Whatever strategy is chosen must communicate breaking changes clearly.

**Research outcome:** Major versions in URL paths are used by Google and other public APIs; Azure uses required date-based query versions; GitHub uses date-based request headers; Stripe pins clients to dated API behavior. Date-based versions suit continuously deployed cloud platforms with multiple snapshots, while visible major-path versions are simpler for self-hosted and containerized software. Standard HTTP `Deprecation` and `Sunset` headers and link relations support runtime lifecycle communication.

**Proposed strategy:**

- Put only the major version in the URL, such as `/v1`.
- Track precise contract releases using semantic versioning in OpenAPI `info.version`.
- Allow backward-compatible additions and fixes within a major version.
- Require a new URL major, such as `/v2`, for breaking contract or behavioral changes.
- Support consecutive major versions concurrently for a documented migration period.
- Publish changelogs and migration guides, expose deprecation and sunset information at runtime, and use automated OpenAPI compatibility checks in CI.

**Follow-up answer:** The strategy is accepted, with the clarification that breaking-change documentation must be human-readable as well as machine-readable.

**Decision:** Adopt the proposed major-path and semantic-contract-version strategy. Every breaking release must include both (1) structured, machine-readable change metadata and (2) human-facing documentation with the rationale, impact, before/after examples, and migration instructions. Clearly announce deprecation and retirement through documentation, hypermedia links, and standard HTTP headers.

## 11. Security ownership and deployment modes

**Question:** For v1 security, should the HTTP package delegate authentication and authorization entirely to host-provided middleware/hooks, or ship with a built-in scheme such as bearer API keys for the standalone Emmett Server?

**Answer:** There are two required modes. The standalone service should support OAuth and, at bare minimum, API keys. The API should also be packable/embeddable in a user's application and inherit that application's security setup. The embedded mode may be post-v1 if it proves significantly harder.

**Decision:** Design for two deployment modes: a secured standalone Emmett Server and an embeddable package. The standalone server must support API keys and OAuth-based authentication. An embedded host must be able to supply and retain its own authentication and authorization middleware. The polished embedded distribution may follow v1, but v1 architecture must keep transport-independent handlers and security hooks so this mode does not require a redesign.

### Security implementation follow-up

**Proposed direction:** Use API keys plus validation of access tokens from configurable external OAuth/OIDC issuers. Let the Web UI use OpenID Connect Authorization Code with PKCE, and service clients use suitable machine-to-machine credentials. Do not make Emmett an identity provider or store local user passwords. Let embedded hosts provide authenticated identities through framework adapters.

**User response:** Asked how comparable embedded systems handle this boundary. Insecure operation should be available as an explicit opt-in, and HTTPS must be supported.

**Decision additions:** Secure operation is the default. An unauthenticated/insecure mode may be enabled only through conspicuous, explicit configuration and must produce clear warnings. Both standalone and embedded deployment documentation must cover HTTPS. The precise ownership of TLS termination and authentication remains to be finalized after comparison with established systems.

**Research outcome:** Aspire provides token, OIDC, and explicit unsecured modes, recommends HTTPS, and supports operation behind a TLS-terminating reverse proxy. Embeddable server libraries commonly provide framework adapters while leaving authentication, TLS, CORS, and related policies to the host.

**Proposed defaults:**

- Standalone authentication modes are `api-key`, `oidc`, and explicit `insecure`.
- Generate a strong one-time API key for local startup when no credential is configured.
- Support direct HTTPS through configured certificate and private-key files.
- Support TLS termination at an explicitly trusted reverse proxy.
- Permit plain HTTP on loopback for local development.
- Require an explicit override, with prominent warnings, for unauthenticated operation or externally reachable plain HTTP.
- Embedded mode delegates authentication and TLS to the host and receives a normalized principal/permissions object through its adapter.

**Follow-up answer:** These defaults make sense. Certificate setup should be streamlined, potentially through development certificates and Let's Encrypt.

**Decision:** Accept the proposed security defaults. Investigate convenient local development certificates and public ACME/Let's Encrypt automation, while keeping direct certificate/key configuration and trusted reverse-proxy termination available.

### Certificate automation follow-up

**Proposed direction:** Provide automatic local development certificates, direct certificate/key configuration, and a first-class Caddy/Let's Encrypt deployment recipe in v1; defer native ACME certificate lifecycle management.

**User response:** Requested research into how other developer tools enable streamlined HTTPS before deciding.

**Research outcome:** .NET/Aspire uses a dedicated development-certificate CLI with create/check/trust/clean/import/export operations. Next.js creates locally trusted certificates through `mkcert` behind an HTTPS development flag and accepts custom certificate paths. Vite can generate and cache a self-signed certificate through a plugin. Caddy manages both a local CA and public ACME certificates. Across these tools, local automation is development-only, certificates are reused, trust-store changes require consent, and custom certificates remain supported.

**Follow-up proposal:** Combine the .NET and Next.js patterns: `emmett serve --https` creates or reuses a development certificate; `emmett certs trust`, `check`, `export`, and `clean` manage its lifecycle; use `mkcert` when available without silently downloading executables or changing trust stores; accept explicit certificate/key/CA paths; use Caddy/ACME as the initial production automation path.

**Follow-up answer:** Accepted.

**Decision:** Adopt the proposed HTTPS CLI model. Development HTTPS is easy and repeatable but explicit about trust. Production supports supplied certificates or trusted reverse-proxy termination, with a first-class Caddy/Let's Encrypt recipe. Native ACME management is deferred.

## 12. Authorization model

**Question:** Should API keys and OAuth tokens carry granular scopes such as `streams:read`, `streams:list`, and `streams:append`, or is a simpler read-only versus read-write permission model sufficient for v1?

**Answer:** The API should have some form of role-based access control (RBAC).

**Decision:** Use RBAC rather than a single binary access flag. Authentication mechanisms produce a normalized principal with roles, and endpoint handlers authorize operations through explicit permissions. The exact built-in roles, customizable roles, permission vocabulary, and resource-level restrictions remain to be defined.

### RBAC evolution

**Question:** Should v1 provide built-in roles such as `viewer`, `editor`, and `admin` while also allowing deployments to define custom roles by mapping OAuth claims or API keys to granular permissions?

**Answer:** Start simple, but establish foundations that can later support granular authorization by stream type and similar resource attributes.

**Decision:** V1 will include simple built-in roles such as `viewer`, `editor`, and `admin`. Internally, roles resolve to named permissions and handlers check permissions rather than hard-coded role names. OAuth claim and API-key mappings feed the normalized principal. Preserve request/resource context in authorization checks so later policies can restrict access by stream type, stream-name pattern, tenant, event type, or operation without revising the HTTP contract.

## 13. API-key administration and licensing

**Question:** Should v1 expose admin endpoints for creating, listing, rotating, and revoking API keys, or should keys initially be managed only through CLI/configuration and secrets?

**Answer:** Initially manage API keys through the CLI. An administration API may be added later if needed. It would also be useful to optionally require users to provide a license key; this may ship just after v1 but must be available before GA.

**Decision:** V1 will not expose HTTP endpoints for API-key lifecycle management. Provide CLI operations and secret/configuration integration for key creation, listing of safe metadata, rotation, and revocation. Add optional license enforcement as a pre-GA capability, kept independent from authentication and authorization. A license key proves entitlement and must never grant API access by itself.

### License validation model

**Question:** Should license validation work offline using a signed license document, or require periodic online activation against a licensing service?

**Answer:** Research how comparable products handle licensing and choose the approach for Emmett.

**Research outcome:** Kong validates signed JSON licenses independently on each node without network access and accepts license data from a file or environment variable. GitLab supports connected activation as well as offline license files for firewalled installations. Redpanda accepts license contents or file paths and recommends Kubernetes Secrets for production. EventStoreDB/Kurrent uses a unified binary in which selected enterprise features require a configured license key. Common patterns include offline validation, container-friendly secret injection, visible expiration status, advance warnings, and preserving access to existing data when entitlements expire.

**Decision:** Use an offline-first, cryptographically signed license document. The payload should include a license ID, issuer/customer metadata, validity dates, edition/feature entitlements, format version, and optional limits; avoid machine/hardware binding because it is fragile in containers and orchestration platforms. Accept the document through a secret-backed environment variable or file path, with CLI commands to inspect and validate it without revealing sensitive contents. Do not require outbound connectivity at runtime. A future optional online service may simplify trials, renewal, revocation checks, and usage reporting, but offline installations remain fully supported. Provide advance expiry warnings and a grace period; licensing failures must never make existing event data unreadable or unexportable.

### Licensing scope clarification

**Question:** After the grace period, should an expired required license make the HTTP API read-only, or should existing read/write workloads continue while only premium configuration and new premium features are blocked?

**Answer:** Review AutoMapper and ShadowTraffic as additional comparisons. The HTTP API and UI may live in a separate repository under a separate license. The commercial licensing type and policy are out of scope for this specification. Some functionality will probably be free/freemium and other functionality paid; premium features should likely stop working without entitlement, while free features may continue.

**Decision:** Do not specify product pricing, license terms, exact free/paid boundaries, or final expiry enforcement in this API specification. Preserve a capability/entitlement boundary so features can be marked free or premium later. Missing or expired entitlement may disable premium capabilities while free capabilities remain available. If the server/UI is split into a separate repository, its repository and distribution license are decided there. Research AutoMapper and ShadowTraffic only for reusable technical patterns.

**Additional research:** AutoMapper performs local, self-contained license checks without network access and only logs warnings for missing, invalid, or expired keys; deployed applications continue to run. ShadowTraffic injects signed licensing material through environment configuration and supports cryptographically chained, short-lived subleases signed by a customer's AWS KMS key for delegation across teams.

**Architectural consequence:** Keep licensing behind a replaceable entitlement-provider interface that returns capabilities to the application layer. Do not expose raw license material in HTTP responses, browser code, logs, or the OpenAPI contract. Support secret-based configuration and status metadata only. Delegated leases or warning-only enforcement can be added later without changing event-store resources.

## 14. Structured stream identity

**Question:** Should stream names remain completely opaque strings to the HTTP API, or should Emmett recognize a structured stream identity such as `{streamType}/{streamId}` for filtering, RBAC, and UI grouping while preserving the underlying physical stream name?

**Answer:** Emmett should recognize structured stream identity, but it is unclear whether the convention should be enforced.

**Decision:** Preserve arbitrary opaque stream names for backward compatibility and generic event-store access. Allow Emmett to associate a stream with structured metadata such as stream type and stream ID. Structured identity enables catalog filtering, UI grouping, application-aware aggregation, and future resource-level RBAC. Whether particular deployments may enforce structured names remains open.

### Stream-name convention

**Question:** Emmett already has a `streamType:streamId` convention in the MongoDB package through `toStreamName` and `fromStreamName`, while other examples use hyphens or opaque names. Should the server recognize `type:id` by default, allow custom parser/formatter functions for existing naming schemes, and enforce a scheme only when a registered stream type explicitly opts in?

**Answer:** Emmett does not currently enforce a stream naming convention, though enforcement may be introduced eventually.

**Decision:** V1 must not enforce a naming convention. Define an optional stream-identity codec abstraction that can parse and format structured identities; provide the existing `type:id` convention as an available/default codec where appropriate and allow custom codecs for established applications. Represent parsing failure as an unstructured stream rather than an API error. Reserve opt-in enforcement for a later version and ensure it can be added without changing resource representations.

## 15. Event wire envelope

**Question:** For events returned over HTTP, should the API preserve Emmett's current combined shape—where user metadata and recorded fields such as `messageId`, `streamPosition`, and `streamName` share one `metadata` object—or define a wire envelope that separates user metadata from server-controlled recording information?

**Answer:** Requested the rationale for separating the two before deciding.

**Clarification:** A separate wire envelope would distinguish client-owned metadata from server-owned recording data for validation, schemas, UI presentation, and future evolution. It would not by itself change Emmett's underlying storage model; the HTTP adapter would still merge the values when calling the current `EventStore`.

**User response:** Changing the payload does not appear to provide meaningful separation.

**Revised direction:** Prefer fidelity to Emmett's existing event shape unless the transport distinction yields a concrete requirement. Collision safety can instead be achieved by defining reserved metadata keys, rejecting attempts to set server-owned fields where appropriate, and specifying deterministic precedence. Final confirmation is pending.

**Follow-up question:** Should the API keep the current combined `metadata` shape and formally reserve fields such as `messageId`, `streamName`, `streamPosition`, `globalPosition`, and `checkpoint` for the server?

**Follow-up answer:** The meaning of reservation is unclear and the HTTP API should behave the same way as Emmett.

**Decision:** Preserve Emmett's existing event and `ReadEvent` shapes in the HTTP representation, including combined metadata. The HTTP layer must not invent additional reserved-field rejection rules or a second event-envelope model. Append metadata is passed through according to the core `EventStore` contract, and recorded events are returned with the system metadata produced by the selected store. Document any existing backend differences and cover them with conformance tests rather than masking them through transport-specific behavior.

**Later clarification:** Server-controlled recorded fields may be treated as reserved specifically on append, since append requests cannot authoritatively assign values such as the resulting stream position. Define this in terms of existing Emmett behavior rather than a new read envelope.

## 16. JSON transport and concurrency metadata

**Question:** How should non-native JSON values be handled over HTTP: require event `data` and custom metadata to be strictly JSON-compatible, or apply Emmett's JSON serializer conventions across the payload—serializing `bigint` as decimal strings and `Date` as ISO strings, with configurable revival on append?

**Answer:** The HTTP API should avoid transforming payloads and should effectively restream/pass through event data. Dates use ISO strings and big integers use strings. Expected stream version should be represented through HTTP headers, specifically an ETag-based mechanism.

**Decision:** Preserve event `data` and custom metadata as transport JSON without schema upcasting, downcasting, or type revival in the HTTP layer. Represent dates as ISO 8601 strings and arbitrary-size integers as decimal strings on the wire. Server-owned position fields are always decimal strings in JSON. Use HTTP entity tags and conditional request headers for optimistic concurrency; the exact mapping of Emmett's expected-version variants remains to be defined.

### Optimistic concurrency mapping

**Question:** Should an append without `If-Match` or `If-None-Match` remain allowed, matching Emmett's current no-concurrency-check default?

**Answer:** Yes.

**Decision:** Map exact expected versions to `If-Match: "<version>"`, `STREAM_EXISTS` to `If-Match: *`, and `STREAM_DOES_NOT_EXIST` to `If-None-Match: *`. Omitting both headers maps to `NO_CONCURRENCY_CHECK` and remains valid. Reject contradictory or malformed conditional headers. Return `412 Precondition Failed` for a failed concurrency condition and include the current ETag when it can be determined. Successful stream reads and appends return the current stream version as a strong `ETag`.

## 17. Stream read direction

**Question:** Should v1 add backward stream reads so the UI can efficiently open a large stream at its newest events, or should it initially expose only Emmett's current forward `from`/`to`/`maxCount` behavior?

**Answer:** Emmett does not currently support backward reads. Add them to the HTTP API only after the capability exists in Emmett.

**Decision:** V1 exposes only forward stream reads backed directly by `readStream` and its `from`, `to`, and `maxCount` options. Document newest-first/backward reads as a future capability dependent on a corresponding core Emmett API. Do not emulate them by loading or reversing an entire stream in the HTTP layer.

## 18. Missing streams

**Question:** When `readStream` reports `streamExists: false`, should `GET /v1/streams/{streamName}` return HTTP `404 Not Found`, or return `200 OK` with an empty stream representation carrying `streamExists: false`?

**Answer:** Prefer `404 Not Found`; requested confirmation of the reasoning.

**Decision:** Return `404 Not Found` when a requested stream does not exist. This is the REST resource equivalent of `streamExists: false`. Use `HEAD /v1/streams/{streamName}` for the direct `streamExists` operation, returning `200` with the stream ETag when it exists and `404` when it does not. Do not return an empty stream representation with `200` for a missing resource.

## 19. Stream representation and message terminology

**Question:** Should `GET /v1/streams/{streamName}` return the requested page of events embedded in the HAL stream representation, or return only stream metadata with a link to a separate `/v1/streams/{streamName}/events` collection?

**Answer:** Prefer embedding the page in the stream representation. Emmett conceptually stores messages in streams rather than only events; workflow streams and message-related functionality should inform the terminology.

**Decision:** `GET /v1/streams/{streamName}` returns stream metadata plus the requested page embedded in the HAL representation, with pagination links. Do not require a separate collection request to render a stream. Re-evaluate the embedded relation name and append terminology using Emmett's broader message model rather than assuming every stored record is an event.

### Message kinds and collection resources

**Question:** Should the HTTP API expose `_embedded.messages`, accept both `kind: "Event"` and `kind: "Command"` on append, and default an omitted `kind` to `"Event"` for compatibility?

**Answer:** Yes for now. In the longer term, an explicit messages API endpoint may be preferable.

**Decision:** Use `message`/`messages` as the HTTP resource terminology. Stream representations embed `_embedded.messages`. Append input accepts `kind: "Event"` and `kind: "Command"`; omitted `kind` defaults to `"Event"`, matching current event behavior. Design an explicit messages collection resource so message operations can evolve independently, while retaining embedded messages as a convenience representation of a stream.

**Follow-up question:** Should v1 include both the embedded stream view and the canonical per-stream `/messages` collection?

**User response:** Requested clarification of what “embedded stream view” and “canonical per-stream messages collection” mean.

**Clarification:** HAL's `_embedded` member can include linked resource representations inline, allowing a UI to obtain stream metadata and a message page in one request. A canonical `/streams/{streamName}/messages` collection would expose the same page separately for direct reads, pagination, and appends. This creates two read paths and HAL-specific response structure.

**User response:** The benefit of `_embedded` is unclear and the representation looks awkward.

**Revised direction:** Favor a simpler linked-resource model: the stream resource contains metadata and links, while the messages collection owns reads, pagination, and appends. HAL links remain useful without requiring embedded resources.

**Follow-up question:** Should v1 omit `_embedded` entirely and use separate stream and messages resources?

**User response:** Requested confirmation that `_embedded` is standardized and a clearer explanation of its benefits.

**Clarification:** `_embedded` is an optional reserved member of the HAL specification. It identifies included linked resources so generic HAL clients can understand their relationships and avoid additional requests. Embedding messages inside a stream resource is optional and unnecessary here, while using `_embedded.messages` for the members of a HAL collection is the standard HAL collection pattern.

**Proposal:** Do not embed messages in the stream resource. Use content negotiation: `application/hal+json` represents collection members under `_embedded.messages` with hypermedia links, while `application/json` returns a straightforward `messages` array.

**Answer:** Accepted.

**Decision:** Support both ordinary JSON and HAL representations through content negotiation. The stream resource contains metadata and links but not inline messages. `GET /v1/streams/{streamName}/messages` returns `{ "messages": [...] }` for `application/json` and a HAL collection with `_embedded.messages` for `application/hal+json`. Hypermedia is available but never required for clients that use documented URLs.

## 20. Pagination and streaming reads

**Question:** What default and maximum page sizes should stream-message reads use? The starting recommendation was 100 by default with a configurable hard maximum of 1,000.

**Answer:** Accept those page sizes. Also support unbounded HTTP/2 streaming.

**Decision:** Ordinary JSON and HAL collection responses default to 100 messages and enforce a configurable maximum of 1,000. Add a distinct streaming response mode that does not impose the page-size hard limit and processes records incrementally with backpressure. Do not buffer an unbounded stream in memory. Specify record framing and cancellation semantics separately; the streaming representation should work efficiently over HTTP/2 while remaining transport-correct where possible over HTTP/1.1.

### Streaming media type

**Question:** Should `application/json-seq` be the canonical unbounded streaming representation?

**Answer:** Yes.

**Decision:** When `GET /v1/streams/{streamName}/messages` is requested with `Accept: application/json-seq`, return an RFC 7464 JSON Text Sequence. Emit one complete recorded-message representation per framed item, flush incrementally, respect transport backpressure, and stop promptly on client cancellation. This representation has no message-count limit and must not be wrapped in a JSON/HAL collection envelope. It should operate over HTTP/2 and remain valid over streaming-capable HTTP/1.1. NDJSON may be added later as an optional compatibility media type.

### Finite and live streaming

**Question:** Should the v1 JSON-sequence response stream the current history and then close, or remain open and continue delivering newly appended messages as a live tail?

**Answer:** Support both.

**Decision:** Support two explicit streaming modes. Snapshot mode streams the selected historical range and closes. Follow mode first catches up from the requested stream position and then remains open for newly appended messages, without gaps or duplicates at the handoff boundary. Snapshot streaming belongs in v1. Follow mode is designed in the contract but may ship immediately after v1 because it depends on a race-free core Emmett subscription/consumer primitive. Both modes use `application/json-seq`, backpressure, cancellation, and resumable stream positions.

**Follow-up question:** Should live tail use the same endpoint with `GET /v1/streams/{streamName}/messages?follow=true`, or a distinct subscription resource such as `/v1/subscriptions`?

**Answer:** Research how other established APIs expose finite reads and live tails before deciding.

**Research outcome:** Kubernetes uses the same collection endpoint with `watch=1` and a resource version for resumability. Docker uses the same logs endpoint with `follow=true`, optionally combined with a starting point. Kurrent/EventStoreDB exposes catch-up subscriptions as a distinct client operation that delivers history and then live events, while named persistent subscriptions are separate managed resources with durable state and acknowledgement semantics.

**Recommendation:** Use `follow=true` on the per-stream messages endpoint for an ephemeral catch-up/live HTTP connection. Resume from a stream position supplied by the client, using exclusive semantics for reconnection. Reserve `/subscriptions` for future durable consumers that have identities, stored checkpoints, acknowledgements, retries, competing consumers, and lifecycle administration.

**User response:** Do not mix live-subscription responsibilities into the messages endpoint. Use a subscriptions API instead, and research how HAL APIs and GraphQL approach subscriptions.

**Decision:** Keep `/streams/{streamName}/messages` focused on finite reads and appends. Live delivery will be exposed through a subscription-oriented API. Research will determine whether subscriptions are transient request streams, explicit managed resources, or both.

### HAL and GraphQL subscription models

**Question:** How do HAL APIs handle subscriptions, and should the design also draw inspiration from GraphQL?

**Answer:** Keep subscription responsibility out of the messages endpoint; investigate established HAL/resource-oriented APIs and GraphQL's model.

**Research outcome:** HAL itself does not define subscription semantics, streaming transports, acknowledgement, or lifecycle. It only standardizes how resources expose links and optionally embedded resources. A HAL API therefore models subscriptions using ordinary resources and advertises the available transitions with typed links or HAL-FORMS templates. Kurrent's HTTP API follows that resource-oriented approach for persistent subscriptions: a named subscription has its own URI and supports create, inspect/consume, update, and delete operations. GraphQL makes `subscription` a distinct root operation type, separate from queries and mutations; executing it creates a stateful operation that maps a source event stream to a response stream until cancellation. GraphQL deliberately leaves serialization, transport, acknowledgements, buffering, resend, and other delivery guarantees to the implementation.

**Recommendation:** Preserve the same conceptual separation. Finite history remains a stream-messages concern. A subscription selects a source stream and starting position and produces a response stream. Use HAL to discover subscription creation and delivery links, while taking from GraphQL the clean separation between finite reads and live operations. Distinguish ephemeral connection-scoped subscriptions from future durable managed subscriptions rather than making every UI live tail durable.

**Follow-up question:** Should v1's `/subscriptions` support only ephemeral, connection-scoped subscriptions, leaving durable named subscriptions for the consumer release immediately afterward?

**Answer:** Support both forms. Subscriptions should be based on Emmett's consumer concept.

**Decision:** Define both ephemeral and durable subscriptions as HTTP-facing uses of the same underlying Emmett consumer/source abstraction. Ephemeral subscriptions are scoped to a live client connection and do not persist lifecycle state. Durable subscriptions have a stable consumer identity and may persist processing position and lifecycle state. Keep the HTTP contract aligned with Emmett consumer concepts such as `consumerId`, start position, caught-up state, start, stop, and close, while avoiding exposure of TypeScript processors or executable handlers over HTTP.

### Durable subscription acknowledgement

**Question:** For durable HTTP consumers, should advancing the checkpoint require an explicit client acknowledgement rather than treating successful network delivery as successful processing?

**Answer:** Support two modes, defaulting to automatic acknowledgement. Research how GraphQL tooling handles this.

**Decision:** Durable subscriptions support `auto` and `explicit` acknowledgement modes, with `auto` as the default. The precise advancement point, acknowledgement operation, batching, failure behavior, and redelivery semantics remain to be specified after reviewing GraphQL transports and comparable tooling.

**Research outcome:** GraphQL and its common transports do not provide per-result processing acknowledgements. The GraphQL specification explicitly leaves acknowledgements, buffering, resend, and other QoS concerns outside the standard. In `graphql-transport-ws`, `connection_ack` only confirms successful connection initialization; server results arrive as `next` frames, and the client sends `complete` only to cancel/finish the operation. It does not acknowledge an individual result. GraphQL-over-SSE similarly sends `next` events until `complete` or connection closure, without a standard durable processing checkpoint. Common GraphQL clients therefore behave like Emmett's proposed `auto` mode: they consume pushed results, reconnect or resubscribe when transport logic permits, but do not tell the server that application processing succeeded. Durable replay guarantees must be added by the application or backing messaging system.

**Recommendation:** Keep `auto` as the GraphQL-like convenience mode and document its weaker loss/replay boundary. Use `explicit` mode for true durable consumers: do not advance the stored checkpoint merely because bytes were written to the network; advance it only after a client acknowledgement. This is an Emmett consumer capability beyond ordinary GraphQL subscriptions, not something to imitate from GraphQL transport protocols.

**Follow-up question:** Should explicit acknowledgement be cumulative, so acknowledging checkpoint `42` confirms successful processing of every message through `42`, matching Emmett's ordered consumer checkpoints?

**User response:** Requested a concrete explanation of how an explicit acknowledgement would be performed over HTTP before deciding.

**Clarification:** One possible design keeps the `application/json-seq` delivery response open while the client sends a separate `POST /v1/subscriptions/{subscriptionId}/acknowledgements` containing the last processed checkpoint. The operation would be cumulative and idempotent. Safely handling reconnect races would also require associating acknowledgements with the active delivery session, making the protocol considerably more stateful.

**Follow-up question:** Should HTTP adopt that separate cumulative acknowledgement request while reserving acknowledgement frames for possible future WebSocket support?

**Answer:** No; this requires too much heavy lifting and appears brittle.

**Revised direction:** Avoid building a bidirectional messaging protocol out of unrelated HTTP requests. Reconsider server-side explicit acknowledgement for the streaming HTTP API. Prefer transport-native streaming plus resumable positions, and reserve stronger acknowledgement semantics for a transport or consumer API that can support them cleanly.

**Follow-up question:** Should HTTP's explicit-ack mode be replaced with a client-managed checkpoint and resume model?

**User response:** Requested clarification of what “replace explicit-ack mode with client-managed checkpoint and resume” means.

**Clarification:** In a client-managed model, each delivered message carries a checkpoint. The client stores its last successfully processed checkpoint and supplies it as an exclusive resume position after reconnecting. The server does not receive acknowledgements or persist per-client progress. This provides resumability but is not a truly durable server-managed consumer, and duplicates remain possible around failures.

**Follow-up question:** Should resumable HTTP subscriptions use client-owned progress while true durable consumers remain a separate post-v1 capability?

**Answer:** Do not optimize the subscription design around the Web UI. Design a proper WebSocket protocol, shipping it in either v1 or v1.1.

**Decision:** WebSocket is the intended bidirectional transport for consumer-backed subscriptions, including acknowledgement and lifecycle messages. Do not replace durable consumer semantics with a UI-oriented client-managed checkpoint workaround. Keep finite stream reads and snapshot `application/json-seq` streaming over HTTP. Design the WebSocket protocol as part of the API family; its exact release target remains to be chosen between v1 and v1.1.

**Follow-up question:** Should the WebSocket protocol be defined and documented alongside v1 but implemented in v1.1 with the consumer API?

**User response:** Clarified that the important requirement is two-way communication on the same channel.

**Decision:** Consumer subscriptions use one full-duplex WebSocket connection. The server sends message deliveries on that socket, and the client sends acknowledgements, negative acknowledgements, cancellation, and control frames back on the same socket. Do not use a streaming HTTP response plus separate acknowledgement requests. Release timing remains open.

**Follow-up question:** Should one WebSocket connection support multiple concurrent subscriptions identified by client-provided operation IDs?

**User response:** Requested research into how established protocols and tools handle this before deciding.

**Research outcome:** Multiplexing multiple logical subscriptions over one physical connection is the established pattern. `graphql-transport-ws` uses a client-generated operation ID; result frames for different active operations can be interleaved, and `complete` terminates only the identified operation. STOMP requires a connection-unique subscription ID on every `SUBSCRIBE`; each delivered `MESSAGE` identifies its subscription, and `UNSUBSCRIBE`, `ACK`, and `NACK` correlate through subscription or acknowledgement identifiers. STOMP also provides the exact acknowledgement family under discussion: `auto` (the default), cumulative `client`, and per-message `client-individual`. NATS similarly uses a client-generated subscription ID (`sid`) for multiple subscriptions on one connection. RSocket generalizes the same approach with multiplexed stream IDs and per-stream flow control.

**Recommendation:** Allow one WebSocket to carry multiple subscriptions. Require a client-chosen ID unique among active subscriptions on that connection and include it on every subscription-scoped frame. Keep connection setup, authentication, heartbeat, and fatal protocol errors connection-scoped; keep delivery, acknowledgement, normal errors, and completion subscription-scoped. Add bounded per-subscription in-flight delivery/flow control so one slow subscription cannot grow memory without limit, while recognizing that all logical subscriptions still share the WebSocket's ordered transport.

**Follow-up question:** Should Emmett follow this established multiplexed model, with client-generated subscription IDs unique within each WebSocket connection?

**Answer:** Yes; follow established best practices.

**Decision:** A single Emmett WebSocket connection supports multiple concurrent logical subscriptions. The client supplies an operation ID that must be unique among active operations on that connection, and every subscription-scoped frame carries that ID. Connection initialization, authentication, heartbeat, and fatal framing/protocol failures are connection-scoped. Delivery, acknowledgement, recoverable errors, and completion are operation-scoped. Implement configurable connection and subscription limits, bounded in-flight delivery, fair scheduling, and cleanup of all active operations when the socket closes.

**Follow-up question:** Given Emmett's ordered checkpoints, should v1 expose only `auto` and cumulative `client` acknowledgement modes, deferring individual acknowledgements?

**Answer:** The cumulative acknowledgement proposal was unclear. V1 should support only automatic acknowledgement.

**Decision:** V1 WebSocket subscriptions use automatic acknowledgement only. Clients send no `ack` or `nack` frames, and the protocol does not expose acknowledgement-mode configuration in v1. Remove the earlier requirement for bidirectional acknowledgement frames from the v1 scope. Reserve explicit acknowledgement as a possible compatible protocol extension for a later release, based on concrete consumer requirements.

**Follow-up question:** Should v1 explicitly document auto-acknowledged WebSocket subscriptions as best-effort/at-most-once delivery, with stronger guarantees deferred?

**Answer:** Do not introduce manual acknowledgement through a different endpoint.

**Clarification:** No acknowledgement HTTP endpoint will exist. V1 remains auto-only and has no acknowledgement frames. If explicit acknowledgement is ever introduced after v1, it must travel as a frame over the same full-duplex WebSocket connection; it must not use a separate HTTP request. The reconnect/resume boundary for auto mode still needs to be specified.

**Follow-up question:** When an auto-mode subscription reconnects, how should Emmett determine the position from which delivery resumes?

**Answer:** Match the existing Emmett consumer `startFrom` behavior: start from the last checkpoint, the beginning, or the end.

**Decision:** WebSocket subscription start positions map directly to `MessageProcessorStartFrom`: `"BEGINNING"`, `"END"`, or `{ "lastCheckpoint": "<checkpoint>" }`. An explicitly supplied `startFrom` overrides any stored checkpoint. When it is omitted for a durable consumer, use its stored checkpoint; if none exists, start at `BEGINNING`, matching current processor behavior. Checkpoints are exclusive: the checkpointed message is not redelivered. Do not introduce a separate WebSocket-only cursor vocabulary.

**Follow-up question:** Should supplying `consumerId` distinguish a durable subscription from an ephemeral subscription?

**Answer:** No. Be explicit and follow the processor model. Progress belongs to a processor identified by `processorId`, and checkpoint persistence can be disabled with `checkpoints: "DISABLED"`.

**Decision:** Do not overload `consumerId` as a durability switch. Keep three identities distinct: the WebSocket operation `id` correlates multiplexed frames for the lifetime of a connection; `processorId` identifies the logical processor whose progress is checkpointed; `consumerId` identifies the running consumer instance and is not the checkpoint key. Subscription checkpoint behavior follows processor configuration. `checkpoints: "DISABLED"` creates an uncheckpointed subscription; otherwise the server-provided checkpointer stores progress under the processor identity (and partition when applicable).

**Follow-up question:** Should every WebSocket subscription require a `processorId`, even when checkpoints are disabled, matching `BaseMessageProcessorOptions`?

**Answer:** Yes for v1. Clients or SDKs may generate an identifier when callers do not care about naming it. Starting with a required identifier is safer because the contract can be loosened compatibly later, and identifiers make subscriptions easier to track.

**Decision:** `processorId` is required on every v1 subscription, including subscriptions with `checkpoints: "DISABLED"`. The server validates it as a stable opaque string. Official clients may offer an explicit auto-generation convenience, but the generated value is still sent on the wire. A future API version may make the field optional without breaking existing clients. Expose the processor ID in subscription status, logs, metrics, traces, and administrative views.

**Follow-up question:** Should v1 reject a second active subscription using the same `processorId` and partition, preventing checkpoint races until competing-consumer semantics are deliberately supported?

**Answer:** Yes, and subscription behavior should generally match existing processor behavior.

**Decision:** V1 permits only one active subscription for a given checkpoint identity (`processorId` plus optional `partition`) within an Emmett Server instance. A conflicting subscribe operation fails at the operation level without closing the WebSocket. More generally, subscription start position, checkpoint lookup/storage, version, partition, caught-up signaling, and lifecycle semantics delegate to and remain consistent with Emmett processors. The transport adapts those semantics; it does not redefine them. Competing consumers require an explicit later design.

**Follow-up question:** What message source should a v1 subscription consume?

**Answer:** Any message source exposed by the configured backend. The interview is now going too deeply into implementation detail.

**Decision:** The subscription API discovers and consumes only sources advertised by the active backend; it does not assume every backend supports the same sources. Source capabilities belong in backend capability metadata and hypermedia controls. Stop the detailed interview here, draft the v1 specification from the settled decisions, and preserve remaining implementation-level choices as explicit deferred decisions.

## 21. Specification handoff

**Question:** Should a new GitHub repository be created and both `spec.md` and `qa.md` committed and pushed?

**User response:** Before deciding on repository creation, identified that the specification did not define the expected endpoint links in sufficient detail.

**Action:** Keep repository creation pending. Add a normative endpoint inventory and HAL/HAL-FORMS link-relation contract, including required, conditional, pagination, documentation, and action links for each resource.

## 22. Technical implementation architecture

**Request:** Research how the server should be implemented at a high level, including native Node.js versus a framework and compatibility with Bun, Deno, and Cloudflare Workers. Do not modify the specification until the proposal is approved.

**Research outcome:** Hono provides a Web-standards HTTP layer with official Node, Bun, Deno, and Cloudflare adapters. Node's native HTTP server is intentionally low-level, and Hono's Node WebSocket integration uses `ws`. Node Web Streams are stable and share the `Request`/`Response`/`ReadableStream` model used by edge runtimes. Bun and Deno offer substantial Node compatibility but still require backend-specific testing. Cloudflare Workers uses Web APIs and supports database connections, while reliable long-lived coordinated WebSockets should use Durable Objects. Emmett already has a Cloudflare D1 event-store adapter. The current `emmett-honojs` package mixes a portable Hono application with `@hono/node-server`, so the application and host responsibilities should be separated.

**Proposal:** Use a Node-first standalone server, a Web-standards core, Hono as the HTTP transport shell, and explicit runtime adapters. Keep contracts and event-store handlers framework-neutral. Split portable contract/core/Hono concerns from Node CLI, TLS, process lifecycle, WebSocket, and observability concerns. Use Web Streams for JSON-sequence responses and a runtime-neutral subscription state machine behind runtime-specific WebSocket adapters. Treat Node 24 as the GA baseline, Bun and Deno as conformance-tested compatibility targets, and Cloudflare as a specialized D1-first adapter whose reliable subscriptions use Durable Objects. Generate OpenAPI 3.1 at build time from framework-neutral route/schema definitions rather than making Hono route inference canonical.

**Answer:** Approved; the architecture direction makes sense.

**Decision:** Incorporate the proposal into `spec.md`. The exact runtime validation/schema library remains replaceable, but Hono, the portability boundaries, runtime support tiers, build-time contract generation, and implementation sequence become part of the implementation specification.

## 23. Embedding into existing APIs

**Question:** Does the architecture allow applications to add the Emmett endpoints to an existing API?

**Answer:** The architecture made this possible through framework-neutral handlers and a portable Hono application, but the specification only guaranteed the standalone server in v1 and deferred embedded packaging.

**Follow-up:** Can an existing Fastify, Express, or similar application mount the endpoints while using Emmett's OpenAPI contract and integrating it with the application's existing OpenAPI document?

**Answer:** Yes. The server should expose a framework-neutral route/schema registry and handlers, plus thin framework adapters. Embedded configuration supplies an event store, mount path, principal mapping, and integration hooks. The contract package can return a rebased Emmett-only OpenAPI document or collision-safely merge its namespaced paths and components into a host OpenAPI 3.1 document. Framework-specific streaming and WebSocket plumbing stays in adapters while semantics remain shared.

**Decision:** Make embedding a v1 capability rather than a deferred packaging detail. V1 provides Hono, Express, and Fastify adapters, a documented public adapter boundary, configurable mount paths, host-authentication integration through normalized principals, and OpenAPI rebasing/composition. All three adapters must pass the shared HTTP conformance suite. Other framework adapters may follow without changing the core contract.
