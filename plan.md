# Production-ready observability setup for expressjs-with-postgresql sample

## Context

The current [tracer.ts](samples/webApi/expressjs-with-postgresql/src/tracer.ts) is a minimal `NodeTracerProvider` with `SimpleSpanProcessor`, HTTP + Express instrumentation, hardcoded service name, no graceful shutdown, no metrics or logs, and it exports to `localhost:4317` with nothing on the other end.

Two goals:

1. Give the sample a realistic, vendor-neutral observability pipeline (traces + metrics + logs through an OTel Collector into Tempo/Prometheus/Loki, visualised in Grafana). A reader should run `docker compose --profile observability up`, `npm start`, hit an endpoint, and **see traces immediately**.
2. Prove the **`setupObservability` orchestration shape** the sample will later lift into `almanac`: multi-provider composition, typed access to each provider's native handle, a generic `Tracer`/`Meter` seam for common patterns that is not an OTel abstraction. Shape the code so extraction into `almanac` + `emmett-expressjs` + `emmett-postgresql` is mechanical.

Grafana's own Node.js docs redirect to upstream `@opentelemetry/*` packages — there is no `@grafana/*` SDK bundle. Vanilla OTel is both the documented path and vendor-neutral.

## Prior art — Nest, Fastify, Hono

- **NestJS**: community `OpenTelemetryModule.forRoot({ serviceName, spanProcessor, instrumentations })`, `@Span` decorators, injectable `TraceService`. Two layers: SDK bootstrap and framework instrumentation.
- **Fastify v5**: native `diagnostics_channel` events on the request lifecycle. Framework doesn't hardcode OTel — exposes a protocol any tracer can subscribe to. Most vendor-neutral of the three.
- **Hono**: cross-runtime, pure middleware, no decorators, vanilla `@opentelemetry/api`. Simplest.

Rules pulled in: keep SDK bootstrap separate from framework instrumentation; helpers stay function-shaped (Emmett isn't DI-heavy); reserve a `diagnostics_channel` seam for later without foreclosing it now.

## Design principles

1. **Provider setups return first-class native handles.** `setupOtel()` returns `{ tracer, meter, shutdown, sdk: NodeSDK }` — `sdk` is a peer of `tracer`/`meter`, not an escape hatch. Users configure provider-specific behaviour through the native handle; the generic interface is for composable common patterns.
2. **The generic `Tracer` / `Meter` interfaces are abstractions for common patterns, not lowest-common-denominator.** As patterns recur across providers, they earn methods on the interface. Provider-specific behaviour stays on the native handle.
3. **`setupObservability` takes providers as a typed object.** Keys are user-chosen, per-provider shapes are inferred by TypeScript. Supports any number of heterogeneous providers (`otel`, `console`, `duckdb`, `pino`, `datadog`, …) in one call.
4. **Manual is not a flag, it's not calling the helper.** `setupObservability` is the convenience path; users who want full control construct an `ObservabilityConfig` themselves and hand it to Emmett.

## Core shapes

Landing in the sample in this PR, destined for almanac:

```ts
// Generic result any provider returns. T is the native handle shape.
export type ObservabilityProvider<T = unknown> = {
  tracer: Tracer;
  meter: Meter;
  shutdown: () => Promise<void>;
} & T;

// OTel-specific provider setup — lives in the sample today, moves to almanac/otel later.
export type SetupOtelOptions = {
  serviceName?: string; // defaults to package.json name, env: OTEL_SERVICE_NAME
  serviceVersion?: string;
  otlpEndpoint?: string; // defaults to http://localhost:4318, env: OTEL_EXPORTER_OTLP_ENDPOINT
  instrumentations?: Instrumentation[];
  resourceAttributes?: Record<string, string>;
};

export const setupOtel: (
  options?: SetupOtelOptions,
) => ObservabilityProvider<{ sdk: NodeSDK }>;

// Orchestration layer — lives in the sample today, moves to almanac core later.
export type SetupObservabilityOptions<
  P extends Record<string, ObservabilityProvider<unknown>>,
> = {
  providers: P;
  sampler?: Sampler;
  propagation?: TracePropagation;
  attributeTarget?: AttributeTarget;
  attributePrefix?: string;
};

export type SetupObservabilityResult<
  P extends Record<string, ObservabilityProvider<unknown>>,
> = {
  observability: ObservabilityConfig; // the generic seam for Emmett
  shutdown: () => Promise<void>; // LIFO: shuts providers down in reverse registration order
  providers: P; // typed access to every provider's native handle
};

export const setupObservability: <
  P extends Record<string, ObservabilityProvider<unknown>>,
>(
  options: SetupObservabilityOptions<P>,
) => SetupObservabilityResult<P>;
```

**How composition works inside `setupObservability`:**

- Collects `provider.tracer` from every entry and wraps them with `compositeTracer(...)`; same for `meter` via `compositeMeter(...)`.
- If a single provider is registered, skips the composite wrapper (returns that provider's tracer/meter directly).
- If zero providers, falls back to `noopTracer()` / `noopMeter()`.
- The resulting `ObservabilityConfig` carries `sampler`/`propagation`/`attributeTarget`/`attributePrefix` defaults from the options.

**Three usage modes from one surface:**

```ts
// Zero-config: one OTel provider.
const { observability } = setupObservability({
  providers: { otel: setupOtel() },
});

// Multi-provider: OTel + Pino + a custom console tracer, typed access to each.
const { observability, providers } = setupObservability({
  providers: {
    otel: setupOtel({ serviceName: "shop" }),
    pino: setupPino({ logger }), // future (almanac/pino)
    duckdb: setupDuckDb({ path: "./traces.db" }), // future (user-land)
  },
  sampler: rateSample(0.1),
});
providers.otel.sdk.forceFlush(); // native handle, typed
providers.duckdb.db.query("..."); // native handle, typed

// Fully manual — skip setupObservability, construct ObservabilityConfig yourself.
const observability: ObservabilityConfig = {
  tracer: compositeTracer(otelTracer(), pinoTracer(logger)),
  meter: otelMeter(),
};
```

## Phased sequence — see traces ASAP, then grow

Each phase leaves the app in a working state and adds one observable thing. Stop and verify in Grafana between phases if you want.

### Phase 1 — Traces in Grafana in under five minutes

Target: one `curl` on an Express endpoint appears as a span in Grafana Tempo.

1. **Replace [src/tracer.ts](samples/webApi/expressjs-with-postgresql/src/tracer.ts) with [src/telemetry.ts](samples/webApi/expressjs-with-postgresql/src/telemetry.ts).** Implements `setupOtel` and `setupObservability` per §Core shapes, but with a minimum payload: `NodeSDK` + `OTLPTraceExporter` (proto, HTTP) + `BatchSpanProcessor` + `HttpInstrumentation` (with `ignoreIncomingRequestHook` for `/health`) + `ExpressInstrumentation`. Graceful shutdown on `SIGTERM`/`SIGINT`, idempotent. Service name resolution: `options.serviceName` → `OTEL_SERVICE_NAME` env → `package.json` `name` → `'unknown-service'`.
2. **[src/index.ts](samples/webApi/expressjs-with-postgresql/src/index.ts)**: top-of-file `const { observability, shutdown } = setupObservability({ providers: { otel: setupOtel() } });`. Keep the in-code call; the `start` script additionally uses `--import` so the same module also side-effects when preloaded.
3. **[docker-compose.yml](samples/webApi/expressjs-with-postgresql/docker-compose.yml)**: add an `observability` profile with three services — `otel-collector`, `tempo`, `grafana`.
4. **New configs under `samples/webApi/expressjs-with-postgresql/docker/observability/`**: `otel-collector.yml` (otlp receiver, batch processor, otlp exporter to `tempo:4317`), `tempo.yml` (local-storage), `grafana/datasources.yml` (Tempo pre-provisioned).
5. **[package.json](samples/webApi/expressjs-with-postgresql/package.json)**: add `@opentelemetry/sdk-node`; `start` becomes `tsx --import ./src/telemetry.ts ./src/index.ts`.

**Verify:** `docker compose --profile observability up -d`, `npm start`, `curl http://localhost:3000/clients/test/shopping-carts/current`, Grafana at `http://localhost:3001` → Explore → Tempo → search by service name → see the request span.

### Phase 2 — Postgres spans nested under the request

Add `@opentelemetry/instrumentation-pg` and include it in `setupOtel`'s default instrumentation list (or pass it explicitly in the sample). One new dep, a couple of lines.

**Verify:** same request now shows nested `pg.query` spans under the HTTP span in Tempo.

### Phase 3 — Logs in Loki, correlated with traces

1. Add `loki` service to the `observability` profile; `loki.yml` config.
2. Add `loki` exporter + pipeline to `otel-collector.yml`.
3. Add Loki datasource to Grafana with `derivedFields` linking log `trace_id` → Tempo.
4. Add `@opentelemetry/exporter-logs-otlp-proto` + `@opentelemetry/sdk-logs` + `@opentelemetry/instrumentation-pino` to deps and to `setupOtel`: `BatchLogRecordProcessor` on a `LoggerProvider`, plus the pino instrumentation (auto-injects `trace_id`/`span_id` into log records).

**Verify:** click a span in Tempo → "Logs for this trace" returns the pino log lines.

### Phase 4 — Metrics in Prometheus

1. Add `prometheus` service to the `observability` profile; `prometheus.yml` with the OTLP receiver enabled.
2. Add `prometheus` exporter + pipeline to `otel-collector.yml`.
3. Add Prometheus datasource to Grafana.
4. Add `@opentelemetry/exporter-metrics-otlp-proto` + `@opentelemetry/sdk-metrics` to deps and to `setupOtel`: `PeriodicExportingMetricReader`.

**Verify:** `otelcol_receiver_accepted_spans_total` and `http.server.request.duration` histogram show up in Grafana's Prometheus Explore.

### Phase 5 — Wiring (A): thread `observability` through the shopping-cart api factory

Goal: `CommandHandler` for the shopping cart receives the resolved observability config without relying on module-scope `otelTracer()`.

Modify [samples/webApi/expressjs-with-postgresql/src/shoppingCarts/api.ts](samples/webApi/expressjs-with-postgresql/src/shoppingCarts/api.ts):

```ts
export const shoppingCartApi = (
  eventStore: EventStore,
  readStore: PongoDb,
  eventPublisher: EventsPublisher,
  getUnitPrice: (id: string) => Promise<number>,
  getCurrentTime: () => Date,
  observability: ObservabilityConfig, // new, last positional arg
): WebApiSetup => {
  const handle = CommandHandler({ evolve, initialState, observability });
  return (router) => {
    /* routes unchanged, close over `handle` */
  };
};
```

Modify [src/index.ts](samples/webApi/expressjs-with-postgresql/src/index.ts) to pass `observability` into the factory:

```ts
const { observability } = setupObservability({
  providers: { otel: setupOtel() },
});

const application = getApplication({
  apis: [
    shoppingCarts.api(
      eventStore,
      readStore.db(),
      bus,
      getUnitPrice,
      () => new Date(),
      observability,
    ),
  ],
});
```

**Verify:** Emmett command spans appear nested inside the HTTP request span in Tempo. The module-level `otelTracer()` import is gone.

### Phase 6 — `ApplicationOptions.observability` in emmett-expressjs + response header middleware

Modify [src/packages/emmett-expressjs/src/application.ts](src/packages/emmett-expressjs/src/application.ts):

```ts
export type ApplicationOptions = {
  apis: WebApiSetup[];
  // ...existing fields...
  observability?: ObservabilityConfig;
};
```

Wiring inside `getApplication`:

- When `observability` is provided, mount a generic middleware setting `x-trace-id: <32 hex>` on responses, populated from `trace.getSpan(context.active())?.spanContext()?.traceId`.
- Do **not** change `WebApiSetup`'s signature in this PR (that's follow-up F3). The api factory wiring from Phase 5 continues to work.

Sample's `index.ts` passes the same `observability` into `getApplication({ ..., observability })`.

Add `@event-driven-io/almanac` to `emmett-expressjs`'s `dependencies` (the public `ObservabilityConfig` type on `ApplicationOptions` pins it in the API surface).

**Verify:** `curl -i` on any non-`/health` endpoint returns `x-trace-id: <32 hex>` matching the trace id in Tempo.

### Phase 7 — README

[README.md](samples/webApi/expressjs-with-postgresql/README.md):

- "Run with observability" quickstart matching Phase 1.
- Three code snippets showing `setupObservability` usage modes (zero-config, multi-provider, fully manual).
- Note that the helpers are the target shapes for the later `almanac` / `emmett-expressjs` / `emmett-postgresql` extraction.

## Follow-up PRs (not this PR, informs design)

- **F1. Extract into almanac.** `setupObservability` becomes `@event-driven-io/almanac`'s core; `setupOtel` becomes `@event-driven-io/almanac/otel`; `setupPino` is added as `@event-driven-io/almanac/pino` wrapping the existing pino provider. Sample's `telemetry.ts` becomes a three-line re-export.
- **F2. Framework instrumentation factories into Emmett packages.** `httpInstrumentations()` + `expressInstrumentations()` move into `@event-driven-io/emmett-expressjs`; `pgInstrumentations()` moves into `@event-driven-io/emmett-postgresql`. Sample composes them when calling `setupOtel({ instrumentations: [...emmettExpressjs(), ...emmettPostgresql()] })`.
- **F3. Wiring (C) via almanac registry.** Once almanac owns `setupObservability`, add a module-level default so `CommandHandler` falls back to the last-resolved config when none is passed. Sample drops the extra `observability` arg from `shoppingCartApi(...)`. Explicit passing still wins.
- **F4. Wiring (B), optional.** Extend `WebApiSetup` to `(router, ctx: { observability: ObservabilityConfig }) => void` so api setups receive observability from `getApplication` without threading it through factory args. Breaking change in `emmett-expressjs`'s public signature; only do this once (C) has settled.
- **F5. `diagnostics_channel` publisher in almanac.** Span start/end emitted on Node's standard channel so non-almanac consumers (Datadog, New Relic, custom logging) can subscribe without implementing `Tracer`. `setupObservability` surface does not change.
- **F6. Evolve `Tracer` / `ActiveSpan`.** As patterns recur across providers, add methods (e.g. `recordErrorAndEnd(err)`, `withPromiseStatus(p)`). Not LCD — deliberate abstractions for common flows. Provider-specific behaviour stays on native handles.

## Dependencies

Added in the sample across phases:

- Phase 1: `@opentelemetry/sdk-node` (existing `-trace-otlp-proto`, `instrumentation-http`, `instrumentation-express`, `sdk-trace-node`, `resources`, `semantic-conventions` stay).
- Phase 2: `@opentelemetry/instrumentation-pg`.
- Phase 3: `@opentelemetry/exporter-logs-otlp-proto`, `@opentelemetry/sdk-logs`, `@opentelemetry/instrumentation-pino`.
- Phase 4: `@opentelemetry/exporter-metrics-otlp-proto`, `@opentelemetry/sdk-metrics`.

Added in `emmett-expressjs` in Phase 6:

- `@event-driven-io/almanac` as a regular dep (public API surface).

## Files touched

- [samples/webApi/expressjs-with-postgresql/src/tracer.ts](samples/webApi/expressjs-with-postgresql/src/tracer.ts) — delete in Phase 1.
- [samples/webApi/expressjs-with-postgresql/src/telemetry.ts](samples/webApi/expressjs-with-postgresql/src/telemetry.ts) — new in Phase 1, grows across phases.
- [samples/webApi/expressjs-with-postgresql/src/index.ts](samples/webApi/expressjs-with-postgresql/src/index.ts) — Phase 1 (setup call) and Phase 5 (pass `observability` to api factory) and Phase 6 (pass `observability` to `getApplication`).
- [samples/webApi/expressjs-with-postgresql/src/shoppingCarts/api.ts](samples/webApi/expressjs-with-postgresql/src/shoppingCarts/api.ts) — Phase 5 (accept `observability` arg, remove module-level `otelTracer()`).
- [samples/webApi/expressjs-with-postgresql/package.json](samples/webApi/expressjs-with-postgresql/package.json) — deps grow per phase; Phase 1 changes `start` script.
- [samples/webApi/expressjs-with-postgresql/docker-compose.yml](samples/webApi/expressjs-with-postgresql/docker-compose.yml) — `observability` profile, services added per phase.
- `samples/webApi/expressjs-with-postgresql/docker/observability/*` — config files added per phase.
- [samples/webApi/expressjs-with-postgresql/README.md](samples/webApi/expressjs-with-postgresql/README.md) — Phase 7.
- [src/packages/emmett-expressjs/src/application.ts](src/packages/emmett-expressjs/src/application.ts) — Phase 6.
- [src/packages/emmett-expressjs/package.json](src/packages/emmett-expressjs/package.json) — Phase 6 (almanac dep).

## Existing code to reuse (not duplicate)

- [src/packages/almanac/src/configuration/options.ts](src/packages/almanac/src/configuration/options.ts#L45-L76) — `ObservabilityConfig`, `ObservabilityOptions`, `Sampler`, `alwaysSample`, `rateSample`. `setupObservability` returns an `ObservabilityConfig`; nothing reinvents these types.
- [src/packages/almanac/src/providers/otel/otelTracer.ts](src/packages/almanac/src/providers/otel/otelTracer.ts) and [otelMeter.ts](src/packages/almanac/src/providers/otel/otelMeter.ts) — bridges to `@opentelemetry/api`. `setupOtel` uses them directly to populate the `ObservabilityProvider`'s `tracer`/`meter`.
- [src/packages/almanac/src/tracers/compositeTracer.ts](src/packages/almanac/src/tracers/compositeTracer.ts) and [src/packages/almanac/src/meters/compositeMeter.ts](src/packages/almanac/src/meters/compositeMeter.ts) — used inside `setupObservability` when there are 2+ providers.
- [src/packages/almanac/src/attributes/attributes.ts](src/packages/almanac/src/attributes/attributes.ts) — `MessagingAttributes`. No new span-attribute string literals.
- [src/packages/emmett/src/observability/](src/packages/emmett/src/observability/) — `EmmettAttributes`, `EmmettMetrics`, `ScopeTypes`. Same rule.

## End-to-end verification (after Phase 6)

1. `npm install`.
2. `docker compose --profile observability up -d` — wait for collector / tempo / loki / prometheus / grafana to report healthy.
3. `npm start` — expect a single line like `Telemetry started (providers: otel)`.
4. Drive traffic:
   - `curl -X POST http://localhost:3000/clients/test/shopping-carts/current/product-items -H 'Content-Type: application/json' -d '{...}'`
   - `curl -i http://localhost:3000/clients/test/shopping-carts/current` → response includes `x-trace-id: <32 hex>`.
   - `curl http://localhost:3000/health` → no span (confirms `ignoreIncomingRequestHook`).
5. Grafana at `http://localhost:3001`:
   - Explore → Tempo → search by service name → nested Express + HTTP + pg + Emmett-command spans under the request span.
   - "Logs for this trace" → Loki returns the pino log lines for that trace id.
   - Explore → Prometheus → `otelcol_receiver_accepted_spans_total` and `http.server.request.duration` histogram present.
6. Multi-provider smoke: in a scratch branch of `telemetry.ts`, add a second provider (e.g., a tiny console tracer) — both OTel (Tempo) and the console receive spans; `providers.otel.sdk` and `providers.console.*` are typed in the IDE.
7. Manual mode: skip `setupObservability`, pass an inline `ObservabilityConfig` to `getApplication` and to `shoppingCartApi`; traces still appear. Proves no runtime reliance on the helper beyond the SDK being started.
8. Collector down / unreachable: `setupObservability` still returns an `ObservabilityConfig` without throwing; app keeps serving. Telemetry is optional, not load-bearing.
9. `npm run test:int` and `npm run test:e2e` — unaffected. If a test hangs on shutdown, have its teardown call `result.shutdown()`.
