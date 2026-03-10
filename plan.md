# Observability Implementation Plan

Reference: [feedback.md](./feedback.md) for architecture rationale, metrics catalog, and discussion conclusions.

All work follows TDD: write failing test, implement minimal code to pass, refactor. Run `npx vitest run` after each step. Run `npx tsc --noEmit` after each phase.

Base path for all files: `src/packages/emmett/src/observability/`

---

## Phase 1: Focused Interfaces

Three focused interface files + their noop/default implementations. These are the user-facing abstractions.

### Step 1.1: EmmettTracer interface + noopTracer

**File to create:** `src/packages/emmett/src/observability/tracer.unit.spec.ts`

Tests to write:

1. `noopTracer: executes the function and returns its result` -- call `tracer.startSpan('test', async () => 42)`, expect result to be `42`.
2. `noopTracer: passes a noop ActiveSpan with setAttributes and spanContext` -- call `tracer.startSpan('test', async (span) => { span.setAttributes({ key: 'value' }); const ctx = span.spanContext(); expect(ctx.traceId).toBe(''); expect(ctx.spanId).toBe(''); })`. Should not throw.
3. `noopTracer: propagates errors from the wrapped function` -- the function throws `new Error('boom')`, expect the startSpan promise to reject with 'boom'.
4. `noopTracer: supports addLink without throwing` -- call `span.addLink({ traceId: 'abc', spanId: 'def' })` inside startSpan.
5. `noopTracer: addEvent does not throw` -- call `span.addEvent('OrderPlaced', { orderId: '123' })` inside startSpan.
6. `noopTracer: recordException does not throw` -- call `span.recordException(new Error('boom'))` inside startSpan.

**File to create:** `src/packages/emmett/src/observability/tracer.ts`

Replace the entire current file. The old `tracer.info/warn/error/log` exports will be removed (they are unused anywhere in the codebase -- verified via grep). Define:

```typescript
type SpanLink = {
  traceId: string;
  spanId: string;
  attributes?: Record<string, unknown>;
};

type SpanContext = {
  traceId: string;
  spanId: string;
};

type ActiveSpan = {
  setAttributes(attrs: Record<string, unknown>): void;
  spanContext(): SpanContext;
  addLink(link: SpanLink): void;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  recordException(error: Error | string): void;
};

// addEvent: records a timestamped event within the span. Uses:
//   1. Domain events as span events (opt-in from feedback.md):
//      span.addEvent('OrderPlaced', { orderId: '123', version: 6 })
//   2. Pino/logging strategies use addEvent to emit structured log lines
//   3. Any mid-operation annotation that isn't a flat attribute
// recordException: records an error with stack trace on the span.
//   OTel strategy -> otelSpan.recordException()
//   Pino strategy -> logger.error({ err, ...attrs })
//   Console strategy -> console.error(err)
//   Noop -> nothing

type StartSpanOptions = {
  parent?: SpanContext;  // explicit parent for cross-boundary propagation
};

type EmmettTracer = {
  startSpan<T>(
    name: string,
    fn: (span: ActiveSpan) => Promise<T>,
    options?: StartSpanOptions,
  ): Promise<T>;
};

const noopSpan: ActiveSpan = {
  setAttributes: () => {},
  spanContext: () => ({ traceId: '', spanId: '' }),
  addLink: () => {},
  addEvent: () => {},
  recordException: () => {},
};

const noopTracer = (): EmmettTracer => ({
  startSpan: async (_name, fn, _options?) => fn(noopSpan),
});
```

Export: `EmmettTracer`, `ActiveSpan`, `SpanContext`, `SpanLink`, `StartSpanOptions`, `noopTracer`, `noopSpan`.

Note on `startSpan` signature: it takes a `name` and an async function that receives an `ActiveSpan`. The implementation wraps the call, times it, records attributes, etc. The noop version just passes through. OTel version will call `@opentelemetry/api`'s `tracer.startActiveSpan()`. ClickHouse version will time the call and insert a row on completion.

### Step 1.2: EmmettMeter interface + noopMeter

**File to create:** `src/packages/emmett/src/observability/meter.unit.spec.ts`

Tests to write:

1. `noopMeter: counter.add does not throw` -- `noopMeter().counter('test.count').add(1, { key: 'value' })`.
2. `noopMeter: histogram.record does not throw` -- `noopMeter().histogram('test.duration').record(42, { status: 'success' })`.
3. `noopMeter: gauge.record does not throw` -- `noopMeter().gauge('test.lag').record(10)`.

**File to create:** `src/packages/emmett/src/observability/meter.ts`

```typescript
type EmmettCounter = {
  add(value: number, attributes?: Record<string, unknown>): void;
};

type EmmettHistogram = {
  record(value: number, attributes?: Record<string, unknown>): void;
};

type EmmettGauge = {
  record(value: number, attributes?: Record<string, unknown>): void;
};

type EmmettMeter = {
  counter(name: string): EmmettCounter;
  histogram(name: string): EmmettHistogram;
  gauge(name: string): EmmettGauge;
};

const noopMeter = (): EmmettMeter => ({
  counter: () => ({ add: () => {} }),
  histogram: () => ({ record: () => {} }),
  gauge: () => ({ record: () => {} }),
});
```

Export: `EmmettMeter`, `EmmettCounter`, `EmmettHistogram`, `EmmettGauge`, `noopMeter`.

Maps to past sample's `MetricsFactory` interface. `counter` = past sample's `Counter.increment`, `histogram` = past sample's `Distribution.record`, `gauge` = new (past sample didn't have it, we need it for `processor.lag_events`).

### Step 1.3: (removed -- EmmettLogger merged into Tracer)

Logging is handled by `addEvent` and `recordException` on `ActiveSpan`. There is no separate Logger interface. The tracer strategy decides where these go:

- OTel strategy: `addEvent` → `otelSpan.addEvent()`, `recordException` → `otelSpan.recordException()` + `setStatus(ERROR)`
- Pino strategy: `addEvent` → `pino.info(attrs, name)`, `recordException` → `pino.error({ err }, name)`
- Console strategy: `addEvent` → `console.log(name, attrs)`, `recordException` → `console.error(err)`
- ClickHouse strategy: `addEvent` → buffers as part of span row, `recordException` → marks span as error + stores exception data
- Noop: both are no-ops

Users who want standalone logging outside of spans (application-level Pino/Winston usage) do that directly — not emmett's concern. emmett instruments its own archetypes, and within those, `addEvent`/`recordException` is the recording mechanism.

### Step 1.4: Composite wrappers (compositeTracer, compositeMeter)

Users can combine multiple strategies: `composite(otel(), clickhouse(conn))`.

**File to create:** `src/packages/emmett/src/observability/composite.unit.spec.ts`

Tests to write:

1. `compositeTracer: calls startSpan on all inner tracers and returns the function result` -- create two "collecting" tracers that push span names to arrays. Call `compositeTracer(t1, t2).startSpan('test', async () => 42)`. Expect both arrays to contain 'test', result to be 42.
2. `compositeTracer: propagates errors from the wrapped function` -- function throws, expect rejection.
3. `compositeTracer: with zero tracers, behaves as noop` -- empty composite returns fn result.
4. `compositeMeter: counter.add calls add on all inner meters` -- two collecting meters, call `compositeMeter(m1, m2).counter('x').add(1)`, both see it.

**File to create:** `src/packages/emmett/src/observability/composite.ts`

For `compositeTracer`: runs `fn` once (with the first tracer's span or noopSpan), then notifies all other tracers of the span completion. The key design decision: the function `fn` only executes once -- composite tracers share the same execution, not run it N times.

Implementation approach for compositeTracer:
- Run fn wrapped by the first tracer's startSpan (so it gets timing, attributes, etc.)
- For other tracers, call startSpan with a function that immediately completes (to register the span in their backends) and manually set the same attributes.
- Alternative simpler approach: run fn once, capture start/end time, then create a "synthetic" span in each tracer. This requires tracers to have a `recordSpan(name, startTime, endTime, attributes)` method -- but that changes the interface. Let me propose both options to Oskar.

Actually, the simplest approach: compositeTracer calls startSpan on each tracer sequentially, but only the FIRST one gets the real `fn`. The others get a no-op fn. After the first startSpan completes, we have the attributes and result. The problem: other tracers won't know the timing or attributes.

Better approach: each tracer's startSpan wraps the function call. For composite, we nest them:
```
tracer1.startSpan('name', (span1) =>
  tracer2.startSpan('name', (span2) =>
    fn(compositeSpan(span1, span2))
  )
)
```
This way each tracer wraps the same execution. Each sees the real duration. The `fn` receives a composite ActiveSpan that forwards `setAttributes` and `addLink` to all inner spans.

Export: `compositeTracer`, `compositeMeter`.

### Step 1.5: ObservabilityOptions type + per-archetype resolvers

**File to create:** `src/packages/emmett/src/observability/options.unit.spec.ts`

Tests to write:

**Per-archetype resolver tests (each resolver gets its own describe block):**

`resolveCommandObservability`:
1. `returns noop tracer, meter, and attributePlacement=both when no options` -- call with undefined.
2. `uses provided tracer and meter` -- pass custom, expect them back.
3. `uses provided attributePlacement` -- pass `'wide'`, expect it.
4. `falls back to parent options` -- parent has tracer, child has none, resolved uses parent's.
5. `child overrides parent` -- both provide tracer, child wins.
6. `does not accept propagation or pollTracing` -- type-level check (compile-time, not runtime test).

`resolveProcessorObservability`:
7. `returns noop tracer, meter, propagation=links, attributePlacement=both when no options`.
8. `uses provided propagation` -- pass `'propagate'`, expect it.
9. `uses provided attributePlacement` -- pass `'tree'`, expect it.
10. `falls back to parent` -- parent has propagation, child has none.
11. `child overrides parent` -- both provide propagation, child wins.

`resolveConsumerObservability`:
12. `returns noop tracer, meter, and pollTracing=off when no options`.
13. `uses provided pollTracing` -- pass `'active'`, expect it.
14. `uses provided pollTracing=verbose` -- pass `'verbose'`, expect it.
15. `falls back to parent pollTracing` -- parent has `pollTracing: 'active'`, child has none.
16. `does not accept attributePlacement or propagation` -- type-level check.

`resolveWorkflowObservability`:
17. `returns noop tracer, meter, propagation=links, attributePlacement=both when no options`.
18. `uses provided propagation and attributePlacement`.
19. `falls back to parent` -- same pattern as processor.

**File to create:** `src/packages/emmett/src/observability/options.ts`

```typescript
type TracePropagation = 'links' | 'propagate';
type AttributePlacement = 'wide' | 'tree' | 'both';
type PollTracing = 'off' | 'active' | 'verbose';

// Full config — single source of truth for all observability knobs.
type ObservabilityConfig = {
  tracer?: EmmettTracer;
  meter?: EmmettMeter;
  propagation?: TracePropagation;
  attributePlacement?: AttributePlacement;
  pollTracing?: PollTracing;
};

// Wrapper type for options objects that carry observability config.
type ObservabilityOptions = {
  observability?: ObservabilityConfig;
};

// Per-archetype config subsets — each archetype only accepts relevant knobs.
// Derived via Pick from ObservabilityConfig so there's one source of truth.
type CommandObservabilityConfig = Pick<ObservabilityConfig, 'tracer' | 'meter' | 'attributePlacement'>;
type ProcessorObservabilityConfig = Pick<ObservabilityConfig, 'tracer' | 'meter' | 'propagation' | 'attributePlacement'>;
type ConsumerObservabilityConfig = Pick<ObservabilityConfig, 'tracer' | 'meter' | 'pollTracing'>;
type WorkflowObservabilityConfig = Pick<ObservabilityConfig, 'tracer' | 'meter' | 'propagation' | 'attributePlacement'>;

// Resolved types — all fields required, defaults applied.
type ResolvedCommandObservability = Required<CommandObservabilityConfig>;
type ResolvedProcessorObservability = Required<ProcessorObservabilityConfig>;
type ResolvedConsumerObservability = Required<ConsumerObservabilityConfig>;
type ResolvedWorkflowObservability = Required<WorkflowObservabilityConfig>;

// Resolve functions — each archetype resolves only what it needs.
const resolveCommandObservability = (
  options: { observability?: CommandObservabilityConfig } | undefined,
  parent?: ObservabilityOptions,
): ResolvedCommandObservability => ({
  tracer: options?.observability?.tracer ?? parent?.observability?.tracer ?? noopTracer(),
  meter: options?.observability?.meter ?? parent?.observability?.meter ?? noopMeter(),
  attributePlacement: options?.observability?.attributePlacement ?? parent?.observability?.attributePlacement ?? 'both',
});

const resolveProcessorObservability = (
  options: { observability?: ProcessorObservabilityConfig } | undefined,
  parent?: ObservabilityOptions,
): ResolvedProcessorObservability => ({
  tracer: options?.observability?.tracer ?? parent?.observability?.tracer ?? noopTracer(),
  meter: options?.observability?.meter ?? parent?.observability?.meter ?? noopMeter(),
  propagation: options?.observability?.propagation ?? parent?.observability?.propagation ?? 'links',
  attributePlacement: options?.observability?.attributePlacement ?? parent?.observability?.attributePlacement ?? 'both',
});

const resolveConsumerObservability = (
  options: { observability?: ConsumerObservabilityConfig } | undefined,
  parent?: ObservabilityOptions,
): ResolvedConsumerObservability => ({
  tracer: options?.observability?.tracer ?? parent?.observability?.tracer ?? noopTracer(),
  meter: options?.observability?.meter ?? parent?.observability?.meter ?? noopMeter(),
  pollTracing: options?.observability?.pollTracing ?? parent?.observability?.pollTracing ?? 'off',
});

const resolveWorkflowObservability = (
  options: { observability?: WorkflowObservabilityConfig } | undefined,
  parent?: ObservabilityOptions,
): ResolvedWorkflowObservability => ({
  tracer: options?.observability?.tracer ?? parent?.observability?.tracer ?? noopTracer(),
  meter: options?.observability?.meter ?? parent?.observability?.meter ?? noopMeter(),
  propagation: options?.observability?.propagation ?? parent?.observability?.propagation ?? 'links',
  attributePlacement: options?.observability?.attributePlacement ?? parent?.observability?.attributePlacement ?? 'both',
});
```

`propagation` controls how async boundaries (command → processor) are traced:
- `'links'` (default): processor creates a fresh trace, adds SpanLink to originating command span. Traces stay short-lived and independent.
- `'propagate'`: processor creates a child span under the originating command's trace. Creates longer traces spanning async boundaries.

Both modes read `traceId`/`spanId` from message metadata. The difference is what they do with it: set it as `parentSpanId` (propagate) or add it as a `SpanLink` (links).

`pollTracing` controls the consumer's polling loop verbosity:
- `'off'` (default): puller is invisible. Processors create their own root spans with links back to producer traces.
- `'active'`: lightweight span per poll iteration that found messages (batch size, query duration). Empty polls are silent.
- `'verbose'`: every poll iteration including empty ones, with backoff timing and `emmett.consumer.poll.empty` attribute.

Per-archetype `Pick` subsets ensure that:
- Command handlers never see `pollTracing` or `propagation` (they produce, not consume).
- Consumers never see `attributePlacement` or `propagation` (those are processor/workflow concerns — propagation happens in each processor, not at the consumer level).
- Processors and workflows see `propagation` and `attributePlacement` but not `pollTracing`.

This follows the `JSONSerializer.from(options)` pattern: resolve from options or return default. The `parent` parameter enables the "configure globally, allow per-operation overrides" flow — the event store passes its observability as parent, per-operation options override.

Export: `ObservabilityOptions`, `ObservabilityConfig`, `TracePropagation`, `AttributePlacement`, `PollTracing`, `CommandObservabilityConfig`, `ProcessorObservabilityConfig`, `ConsumerObservabilityConfig`, `WorkflowObservabilityConfig`, `ResolvedCommandObservability`, `ResolvedProcessorObservability`, `ResolvedConsumerObservability`, `ResolvedWorkflowObservability`, `resolveCommandObservability`, `resolveProcessorObservability`, `resolveConsumerObservability`, `resolveWorkflowObservability`.

### Step 1.6: ObservabilityScope + createScope

The `ObservabilityScope` is the core abstraction for instrumented operations. It carries context (root span, config, meter) so that child operations can set attributes without knowing about placement config.

**File to create:** `src/packages/emmett/src/observability/scope.unit.spec.ts`

Tests to write:

1. `createScope: startScope executes the function and returns its result` -- call `createScope(o11y).startScope('test', async () => 42)`, expect 42.
2. `createScope: root scope setAttributes sets on root span` -- verify attributes land on the span regardless of placement config.
3. `createScope: child scope with placement=wide sets attributes on root span only` -- create a collecting tracer, `startScope('root', (scope) => scope.scope('child', (child) => { child.setAttributes({ x: 1 }); }))`. Verify 'x' is on root span, NOT on child span.
4. `createScope: child scope with placement=tree sets attributes on child span only` -- same setup, verify 'x' is on child span, NOT on root span.
5. `createScope: child scope with placement=both sets attributes on both spans` -- verify 'x' is on both.
6. `createScope: scope.span gives access to the underlying ActiveSpan` -- call `scope.span.addEvent('test')`, verify it doesn't throw.
7. `createScope: scope.meter gives access to the meter` -- call `scope.meter.counter('x').add(1)`, verify collecting meter sees it.
8. `createScope: child scopes nest correctly` -- `scope.scope('a', (a) => a.scope('b', (b) => ...))` creates two child spans.
9. `createScope: root scope carries emmett.scope.main=true` -- verify attribute on root span.
10. `createScope: child scopes do NOT carry emmett.scope.main` -- verify attribute absent on child spans.

**File to create:** `src/packages/emmett/src/observability/scope.ts`

```typescript
type ObservabilityScope = {
  // Set attributes — respects attributePlacement config.
  // On root scope: always sets on root span (span === root).
  // On child scope: 'wide' → root only, 'tree' → child only, 'both' → both.
  setAttributes(attrs: Record<string, unknown>): void;

  // Create a child scope — always creates a child span.
  scope<T>(name: string, fn: (child: ObservabilityScope) => Promise<T>): Promise<T>;

  // Access to the underlying span for advanced use (addEvent, recordException, spanContext).
  span: ActiveSpan;

  // Access to meter for recording metrics within this scope.
  meter: EmmettMeter;
};

// createScope accepts any resolved observability that has tracer + meter.
// attributePlacement is optional — defaults to 'both' if absent (e.g., consumer).
type ScopeObservability = {
  tracer: EmmettTracer;
  meter: EmmettMeter;
  attributePlacement?: AttributePlacement;
};

const createScope = (
  observability: ScopeObservability,
) => ({
  startScope: <T>(
    name: string,
    fn: (scope: ObservabilityScope) => Promise<T>,
  ): Promise<T> =>
    observability.tracer.startSpan(name, async (rootSpan) => {
      rootSpan.setAttributes({ [EmmettAttributes.scope.main]: true });

      const makeScope = (span: ActiveSpan, root: ActiveSpan): ObservabilityScope => ({
        setAttributes: (attrs) => {
          const placement = observability.attributePlacement ?? 'both';
          if (placement === 'wide' || placement === 'both') {
            root.setAttributes(attrs);
          }
          if (placement === 'tree' || placement === 'both') {
            span.setAttributes(attrs);
          }
        },
        scope: (childName, childFn) =>
          observability.tracer.startSpan(childName, async (childSpan) =>
            childFn(makeScope(childSpan, root)),
          ),
        span,
        meter: observability.meter,
      });

      return fn(makeScope(rootSpan, rootSpan));
    }),
});
```

On the root scope, `span === root`, so `setAttributes` always hits the root span regardless of placement. On child scopes, `span !== root`, so placement determines the target. The root span reference is captured in the closure and threaded to all descendants.

Export: `ObservabilityScope`, `ScopeObservability`, `createScope`.

### Step 1.7: Attribute name constants + semantic conventions

All attribute and metric names are grouped into const objects to avoid stringly-typed code. Collectors and tests reference these constants — no magic strings.

**File to create:** `src/packages/emmett/src/observability/attributes.ts`

```typescript
const EmmettAttributes = {
  scope: {
    type: 'emmett.scope.type',
    main: 'emmett.scope.main',
    name: 'emmett.scope.name',
  },
  command: {
    type: 'emmett.command.type',
    status: 'emmett.command.status',
    eventCount: 'emmett.command.event_count',
    eventTypes: 'emmett.command.event_types',
    origin: 'emmett.command.origin',
    validationError: 'emmett.command.validation_error',
  },
  stream: {
    name: 'emmett.stream.name',
    type: 'emmett.stream.type',
    versionBefore: 'emmett.stream.version.before',
    versionAfter: 'emmett.stream.version.after',
  },
  eventStore: {
    operation: 'emmett.eventstore.operation',
    read: {
      eventCount: 'emmett.eventstore.read.event_count',
      eventTypes: 'emmett.eventstore.read.event_types',
      durationMs: 'emmett.eventstore.read.duration_ms',
      status: 'emmett.eventstore.read.status',
    },
    append: {
      batchSize: 'emmett.eventstore.append.batch_size',
      durationMs: 'emmett.eventstore.append.duration_ms',
      status: 'emmett.eventstore.append.status',
    },
  },
  decide: {
    durationMs: 'emmett.decide.duration_ms',
  },
  event: {
    type: 'emmett.event.type',
  },
  processor: {
    id: 'emmett.processor.id',
    type: 'emmett.processor.type',
    batchSize: 'emmett.processor.batch_size',
    eventTypes: 'emmett.processor.event_types',
    status: 'emmett.processor.status',
    checkpointBefore: 'emmett.processor.checkpoint.before',
    checkpointAfter: 'emmett.processor.checkpoint.after',
    lagEvents: 'emmett.processor.lag_events',
  },
  workflow: {
    id: 'emmett.workflow.id',
    type: 'emmett.workflow.type',
    inputType: 'emmett.workflow.input.type',
    step: 'emmett.workflow.step',
    stateStatus: 'emmett.workflow.state.status',
    stateTransition: 'emmett.workflow.state.transition',
    outputs: 'emmett.workflow.outputs',
    outputsCount: 'emmett.workflow.outputs.count',
    streamPosition: 'emmett.workflow.stream_position',
    decideDurationMs: 'emmett.workflow.decide.duration_ms',
    evolveDurationMs: 'emmett.workflow.evolve.duration_ms',
    stateRebuildEventCount: 'emmett.workflow.state_rebuild.event_count',
  },
  consumer: {
    source: 'emmett.consumer.source',
    batchSize: 'emmett.consumer.batch_size',
    processorCount: 'emmett.consumer.processor_count',
    earliestCheckpoint: 'emmett.consumer.earliest_checkpoint',
    lag: 'emmett.consumer.lag',
    delivery: {
      processorId: 'emmett.consumer.delivery.processor_id',
      status: 'emmett.consumer.delivery.status',
    },
  },
} as const;

const MessagingAttributes = {
  system: 'messaging.system',
  operationType: 'messaging.operation.type',
  destinationName: 'messaging.destination.name',
  batchMessageCount: 'messaging.batch.message_count',
  messageId: 'messaging.message.id',
  messageConversationId: 'messaging.message.conversation_id',
  messageBodySize: 'messaging.message.body.size',
  consumerGroupName: 'messaging.consumer.group.name',
} as const;

const EmmettMetrics = {
  command: {
    handlingDuration: 'emmett.command.handling.duration',
  },
  event: {
    appendingCount: 'emmett.event.appending.count',
    readingCount: 'emmett.event.reading.count',
  },
  stream: {
    readingDuration: 'emmett.stream.reading.duration',
    readingSize: 'emmett.stream.reading.size',
    appendingDuration: 'emmett.stream.appending.duration',
    appendingSize: 'emmett.stream.appending.size',
  },
  processor: {
    processingDuration: 'emmett.processor.processing.duration',
    lagEvents: 'emmett.processor.lag_events',
  },
  workflow: {
    processingDuration: 'emmett.workflow.processing.duration',
  },
  consumer: {
    pollDuration: 'emmett.consumer.poll.duration',
    deliveryDuration: 'emmett.consumer.delivery.duration',
  },
} as const;

const ScopeTypes = {
  command: 'command',
  processor: 'processor',
  workflow: 'workflow',
  consumer: 'consumer',
} as const;

const MessagingSystemName = 'emmett' as const;
```

Export: `EmmettAttributes`, `MessagingAttributes`, `EmmettMetrics`, `ScopeTypes`, `MessagingSystemName`.

**File to create:** `src/packages/emmett/src/observability/attributes.unit.spec.ts`

Tests:
1. `EmmettAttributes: all leaf values are prefixed with emmett.` -- recursively iterate all leaf values, verify each starts with `'emmett.'`.
2. `MessagingAttributes: all values are prefixed with messaging.` -- same pattern.
3. `EmmettMetrics: all leaf values are prefixed with emmett.` -- same pattern.
4. `no duplicate values across all attribute constants` -- collect all leaf values, verify no collisions.

These are structural tests that catch typos and naming drift.

---

Every scope created by emmett collectors carries semantic attributes for filtering, sampling, and routing:

```
EmmettAttributes.scope.type  = 'command' | 'processor' | 'workflow' | 'consumer'
EmmettAttributes.scope.main  = true  (only on root scope — Morrell's main=true convention)
EmmettAttributes.scope.name  = 'BankAccount' | 'OrderProcessor' (archetype-specific identifier)
```

These enable:
- **Filtering**: show only `emmett.scope.main=true` spans for wide event querying
- **Routing**: OTel Collector routes `emmett.scope.type=command` to ClickHouse via routing processor
- **Sampling**: tail-based sampling — always keep `error=true`, sample 10% of `emmett.scope.main=true` with `emmett.command.status=success`

For event store operations, OTel messaging semantic conventions apply:

| Constant | Wire Value | emmett Concept |
|---|---|---|
| `MessagingAttributes.system` | `messaging.system` | `'emmett'` |
| `MessagingAttributes.messageId` | `messaging.message.id` | `messageId` |
| `MessagingAttributes.messageConversationId` | `messaging.message.conversation_id` | `correlationId` |
| `MessagingAttributes.batchMessageCount` | `messaging.batch.message_count` | event count in append/batch |
| `MessagingAttributes.operationType` | `messaging.operation.type` | `'send'` / `'process'` / `'receive'` |
| `MessagingAttributes.destinationName` | `messaging.destination.name` | stream name |
| `MessagingAttributes.messageBodySize` | `messaging.message.body.size` | serialized event size |

For batches, per OTel guidance: "If the attribute value is the same for all messages in the batch, set it on the span. If values differ, set them on span links or span events."

Collectors set these automatically. `EmmettAttributes.scope.main` is set by `createScope`'s `startScope`. `EmmettAttributes.scope.type` and `EmmettAttributes.scope.name` are set by each domain collector.

### Step 1.8: Update exports

**Modify:** `src/packages/emmett/src/observability/index.ts`

Replace current `export * from './tracer'` with:

```typescript
export * from './tracer';
export * from './meter';
export * from './composite';
export * from './options';
export * from './scope';
export * from './attributes';
```

**Verify:** `src/packages/emmett/src/index.ts` already has `export * from './observability'` (it doesn't currently -- check and add if missing. Currently it does NOT export observability, since only internal `tracer` was there. It may need adding).

Actually, looking at `src/packages/emmett/src/index.ts`, it does NOT have `export * from './observability'`. We need to add it so users can import the types.

**Run:** `npx vitest run` for all observability tests, then `npx tsc --noEmit`.

---

## Phase 2: correlationId / causationId on message metadata

### Step 2.1: Add fields to CommonRecordedMessageMetadata

**File to modify:** `src/packages/emmett/src/typing/message.ts`

Add to `CommonRecordedMessageMetadata` (line 76-81):

```typescript
export type CommonRecordedMessageMetadata = Readonly<{
  messageId: string;
  streamPosition: StreamPosition;
  streamName: string;
  checkpoint?: ProcessorCheckpoint | null;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  spanId?: string;
}>;
```

These four fields:
- `correlationId` -- business flow identifier, propagated through the entire chain (command -> events -> processor -> new commands -> new events). Survives async boundaries. Configurable: can be an independent UUID or mapped to traceId.
- `causationId` -- direct trigger identifier. For events from handleCommand, defaults to the command's messageId. For processor reactions, defaults to the triggering event's messageId.
- `traceId` -- trace identifier from the active span at append time. Used for creating SpanLinks in processors.
- `spanId` -- span identifier from the active span at append time. Used together with traceId for SpanLinks.

**Test:** Write a test in `src/packages/emmett/src/typing/message.unit.spec.ts` (create if needed) that verifies RecordedMessage accepts objects with these new fields and that existing code without them still compiles (the fields are optional, so this is a type-level check -- the test just creates objects with and without the fields).

**Run:** `npx tsc --noEmit` to verify no existing code breaks. All fields are optional, so nothing should break.

### Step 2.2: Auto-populate in in-memory event store append

**File to modify:** `src/packages/emmett/src/eventStore/inMemoryEventStore.ts`

In the `appendToStream` method (around line 190-213), the metadata creation currently looks like:

```typescript
const metadata: ReadEventMetadataWithGlobalPosition = {
  streamName,
  messageId: uuid(),
  streamPosition: BigInt(currentEvents.length + index + 1),
  globalPosition,
  checkpoint: bigIntProcessorCheckpoint(globalPosition),
};
```

After the change, it should also propagate `correlationId`, `causationId`, `traceId`, `spanId` from the event's existing metadata (if the caller set them) into the recorded metadata. The spread already happens at line 205-206:

```typescript
metadata: {
  ...('metadata' in event ? (event.metadata ?? {}) : {}),
  ...metadata,
},
```

This means user-provided correlationId/causationId from event.metadata already flow through. The recorded metadata fields (`streamName`, `messageId`, etc.) override, but correlationId/causationId are NOT in the recorded metadata, so they survive the spread. This should work without code changes -- just the type change from Step 2.1.

**Test:** In `src/packages/emmett/src/eventStore/inMemoryEventStore.unit.spec.ts` (or create a new test file), write a test that:
1. Appends events where the events have `metadata: { correlationId: 'corr-1', causationId: 'cause-1' }`.
2. Reads the stream back.
3. Verifies the recorded events have `correlationId: 'corr-1'` and `causationId: 'cause-1'` in their metadata.

### Step 2.3: Auto-populate in handleCommand

This is where causationId and correlationId get automatically set on produced events. The handleCommand function knows the command context and can stamp all produced events.

**File to modify:** `src/packages/emmett/src/commandHandling/handleCommand.ts`

After line 164 (`eventsToAppend = [...eventsToAppend, ...newEvents]`), before the append call (line 192), we need to stamp each event with:
- `causationId`: the command's messageId (if available from handle options) or a generated UUID
- `correlationId`: propagated from handle options, or generated
- `traceId` and `spanId`: from the current span context (will be added in Phase 4 when we wire the collector)

For now (Phase 2), just support passing correlationId/causationId via handle options and stamping them on events. The auto-population from span context comes in Phase 4.

**Add to HandleOptions type** (or to a new type alongside it):

```typescript
type MessageContextOptions = {
  correlationId?: string;
  causationId?: string;
};
```

In the handleCommand flow, before appending, stamp events:

```typescript
const stampedEvents = eventsToAppend.map(event => ({
  ...event,
  metadata: {
    ...('metadata' in event ? event.metadata : {}),
    ...(handleOptions?.correlationId ? { correlationId: handleOptions.correlationId } : {}),
    ...(handleOptions?.causationId ? { causationId: handleOptions.causationId } : {}),
  },
}));
```

**Test:** `src/packages/emmett/src/commandHandling/handleCommand.unit.spec.ts`

1. Call handleCommand with `{ correlationId: 'flow-1' }` in handle options. Read the stream. Verify produced events have `correlationId: 'flow-1'` in their recorded metadata.
2. Call handleCommand without correlationId. Verify events don't have it (or have an auto-generated one -- decision: auto-generate or leave undefined? Per feedback.md: "auto with opt-out". So auto-generate a UUID if not provided).

**Run:** All existing tests pass. New tests pass.

---

## Phase 3: Wire ObservabilityOptions into existing option types

### Step 3.1: Add `& ObservabilityOptions` to option types

**Files to modify (one line change each -- add `& ObservabilityOptions` to the type intersection):**

1. `src/packages/emmett/src/commandHandling/handleCommand.ts` line 74:
   - Current: `} & JSONSerializationOptions;`
   - Change to: `} & JSONSerializationOptions & ObservabilityOptions;`
   - Add import: `import type { ObservabilityOptions } from '../observability';`

2. `src/packages/emmett/src/eventStore/eventStore.ts` line 137:
   - `ReadStreamOptions`: add `& ObservabilityOptions` to the end
   - Add import

3. `src/packages/emmett/src/eventStore/eventStore.ts` line 206:
   - `AppendToStreamOptions`: the `schema` sub-property currently has `& JSONSerializationOptions`. Add `& ObservabilityOptions` to the top-level type, not inside schema.
   - Change `AppendToStreamOptions` to: `{ expectedStreamVersion?; schema?; } & ObservabilityOptions`

4. `src/packages/emmett/src/processors/processors.ts` line 161:
   - `BaseMessageProcessorOptions`: add `& ObservabilityOptions`

5. `src/packages/emmett/src/projections/index.ts` line 64:
   - `ProjectionDefinition`: add `& ObservabilityOptions`

**Test:** `npx tsc --noEmit` passes. All existing tests pass (observability is optional with `?`, defaults to noop via per-archetype resolvers).

No runtime behavior changes yet. This just makes the types accept observability configuration.

---

## Wide Events Design: Attribute Placement

Child spans for sub-operations **always get created**. They represent real operations in the trace tree. The configurable part is **where attributes land**: on the main span (wide event), on child spans (span tree), or both.

### `attributePlacement` option

```typescript
type AttributePlacement = 'wide' | 'tree' | 'both';
```

- **`'wide'`** — Timing/detail attributes on the **main span**. Child spans exist but are lightweight (just name + duration).
- **`'tree'`** — Attributes on **each child span**. Main span has summary only (status, event count).
- **`'both'`** (default) — Attributes on **both**. Redundant but gives full power for wide event querying AND span tree drill-down.

Example with `'both'` (default):

```
Span: "command.handle"                        ← all attributes
  emmett.scope.type: "command"
  emmett.scope.main: true
  emmett.scope.name: "BankAccount"
  emmett.command.event_count: 2
  emmett.command.event_types: ["DepositRecorded", "CashWithdrawnFromAtm"]
  emmett.command.status: "success"
  emmett.stream.name: "BankAccount-123"
  emmett.stream.type: "BankAccount"
  emmett.stream.version.before: 5
  emmett.stream.version.after: 7
  emmett.eventstore.read.duration_ms: 30
  emmett.eventstore.read.event_count: 5
  emmett.decide.duration_ms: 10
  emmett.eventstore.append.duration_ms: 15
  messaging.system: "emmett"
  messaging.destination.name: "BankAccount-123"
  messaging.batch.message_count: 2
  └── Span: "eventStore.readStream"           ← also has attributes
        emmett.eventstore.read.event_count: 5
        emmett.eventstore.read.duration_ms: 30
        messaging.operation.type: "receive"
        messaging.destination.name: "BankAccount-123"
  └── Span: "decide"
        emmett.decide.duration_ms: 10
  └── Span: "eventStore.appendToStream"
        emmett.eventstore.append.batch_size: 2
        emmett.stream.version.before: 5
        emmett.stream.version.after: 7
        messaging.operation.type: "send"
        messaging.batch.message_count: 2
```

With `'wide'`, the child spans exist but are lightweight (no rich attributes on them — only `messaging.*` conventions that identify the operation). With `'tree'`, the main span only has summary attributes (status, event count, `emmett.scope.*`), and the detail lives on each child.

Default is `'both'` because:
- Wide event queries work out of the box (filter/group on main span attributes)
- Span tree drill-down also works (click into child spans)
- Attribute duplication cost is negligible for most workloads
- Users who care about telemetry volume switch to `'wide'` or `'tree'`

### Attribute naming convention

All emmett-specific attributes use the `emmett.` prefix per OTel custom namespace guidelines. OTel standard conventions (e.g., `messaging.*`, `http.*`, `error.*`) keep their standard names.

```
emmett.scope.type          — archetype: 'command' | 'processor' | 'workflow' | 'consumer'
emmett.scope.main          — true on root scope (Morrell's main=true convention)
emmett.scope.name          — archetype-specific identifier (aggregate type, processor ID)
emmett.command.*           — command handling attributes
emmett.stream.*            — stream-related attributes
emmett.eventstore.*        — event store operation attributes
emmett.processor.*         — processor/reactor/projector attributes
emmett.workflow.*          — workflow step attributes
emmett.consumer.*          — consumer poll cycle attributes
emmett.decide.*            — business logic decision attributes
messaging.*                — OTel messaging conventions (standard, no prefix)
```

### How handleCommand uses the scope

```typescript
// Inside CommandHandler (handleCommand.ts), after resolving observability:
const { startScope } = createScope(resolveCommandObservability(handleOptions));
const A = EmmettAttributes;
const M = MessagingAttributes;

return startScope('command.handle', async (scope) => {
  // Semantic attributes set by collector on root scope
  // (EmmettAttributes.scope.main=true is set automatically by createScope)
  scope.span.setAttributes({
    [A.scope.type]: ScopeTypes.command,
    [A.scope.name]: streamType,
    [A.stream.name]: streamName,
    [A.stream.type]: streamType,
    [M.system]: MessagingSystemName,
    [M.destinationName]: streamName,
  });

  // Step 1: Read — child scope 'eventStore.readStream'
  // child.setAttributes respects attributePlacement config
  const aggregation = await scope.scope('eventStore.readStream', async (child) => {
    child.span.setAttributes({
      [M.operationType]: 'receive',
      [M.destinationName]: streamName,
    });
    const result = await eventStore.aggregateStream(streamName, { evolve, initialState });
    child.setAttributes({
      [A.eventStore.read.eventCount]: result.events.length,
    });
    return result;
  });

  // Step 2: Decide — child scope 'decide'
  const newEvents = await scope.scope('decide', async (child) => {
    return handler(aggregation.state);
  });

  // Step 3: Append — child scope 'eventStore.appendToStream'
  const appendResult = await scope.scope('eventStore.appendToStream', async (child) => {
    child.span.setAttributes({
      [M.operationType]: 'send',
      [M.batchMessageCount]: newEvents.length,
    });
    const result = await eventStore.appendToStream(streamName, newEvents, { expectedStreamVersion });
    child.setAttributes({
      [A.eventStore.append.batchSize]: newEvents.length,
      [A.stream.versionBefore]: Number(aggregation.currentStreamVersion),
      [A.stream.versionAfter]: Number(result.nextExpectedStreamVersion),
    });
    return result;
  });

  // Summary attributes — directly on root span (scope === root, placement doesn't matter)
  scope.span.setAttributes({
    [A.command.eventCount]: newEvents.length,
    [A.command.eventTypes]: [...new Set(newEvents.map(e => e.type))],
    [A.command.status]: 'success',
    [A.stream.versionBefore]: Number(aggregation.currentStreamVersion),
    [A.stream.versionAfter]: Number(appendResult.nextExpectedStreamVersion),
    [M.batchMessageCount]: newEvents.length,
  });

  return { ...appendResult, newEvents, newState: state };
});
```

Note the two ways to set attributes:
- `scope.setAttributes(attrs)` — placement-aware. On child scopes, respects `attributePlacement` config (wide/tree/both).
- `scope.span.setAttributes(attrs)` — direct. Always sets on the scope's own span. Used for semantic convention attributes (`MessagingAttributes.*`, `EmmettAttributes.scope.*`) that identify the operation rather than describe results.

### How reactor/processor uses the scope

Same pattern. The processor collector creates one `processor.handle` root scope per batch. Each message gets a child scope:

```typescript
// Inside reactor's handle method (processors.ts):
const { startScope } = createScope(resolveProcessorObservability(options));
const A = EmmettAttributes;
const M = MessagingAttributes;

return startScope('processor.handle', async (scope) => {
  // (EmmettAttributes.scope.main=true is set automatically by createScope)
  scope.span.setAttributes({
    [A.scope.type]: ScopeTypes.processor,
    [A.scope.name]: processorId,
    [A.processor.id]: processorId,
    [A.processor.type]: processorType,
    [M.system]: MessagingSystemName,
    [M.consumerGroupName]: processorId,
  });

  for (const message of messages) {
    await scope.scope(`processor.message.${message.type}`, async (child) => {
      child.span.setAttributes({
        [M.operationType]: 'process',
        [M.messageId]: message.metadata?.messageId,
      });

      // SpanLink to originating command trace
      if (message.metadata?.traceId && message.metadata?.spanId) {
        child.span.addLink({
          traceId: message.metadata.traceId,
          spanId: message.metadata.spanId,
        });
      }

      await eachMessage(message, context);
    });
  }

  scope.span.setAttributes({
    [A.processor.batchSize]: messages.length,
    [A.processor.eventTypes]: [...new Set(messages.map(m => m.type))],
    [M.batchMessageCount]: messages.length,
  });
});
```

### Per-archetype child scopes

| Archetype | Sub-operations that get child scopes |
|---|---|
| CommandHandler | `eventStore.readStream`, `decide`, `eventStore.appendToStream` |
| Processor | per-message handler (one child per message in batch) |
| Workflow | `workflow.evolve` (state rebuild), `workflow.decide`, `workflow.route` |
| Consumer | per-processor delivery (one child per processor) |

### What emmett does vs what the user does

**emmett does automatically (via collectors wired into archetypes):**
- Creates the root scope (with `emmett.scope.main=true`) for each unit-of-work
- Creates child scopes for each sub-operation
- Times each sub-operation automatically (span duration)
- Places attributes per `attributePlacement` config via `scope.setAttributes()`
- Sets `emmett.scope.*` semantic attributes for filtering/routing
- Sets `messaging.*` OTel conventions for interoperability
- Records metrics (histograms, counters)
- Stamps traceId/spanId/correlationId/causationId on produced events

**The user does NOT need to:**
- Call `Date.now()` or measure timings
- Know attribute names from the metrics catalog
- Create scopes manually for standard operations
- Understand placement config to get correct behavior

**The user CAN optionally:**
- Add custom attributes via `scope.span.setAttributes({ 'my.custom.attr': value })`
- Add span events for extra detail: `scope.span.addEvent('ValidationPassed', { rules: 5 })`
- Record exceptions: `scope.span.recordException(error)`
- Wrap their own `tracer.startSpan` around `handleCommand` for custom instrumentation

---

## Context Propagation Design

emmett manages context propagation explicitly through two mechanisms. No AsyncLocalStorage — if the user plugs in OTel as a strategy, OTel handles its own context internally, but emmett's own flow is explicit.

### Mechanism 1: Handler context (synchronous flow)

Within a single operation (e.g., handleCommand), the span flows through emmett's existing handler context/options. The collector creates the span and passes it through internal operations:

```
HTTP handler
  └── tracer.startSpan('POST /orders', (httpSpan) =>
        handleCommand(store, id, handler, {
          observability: { tracer, meter, propagation: 'links' }
        })
      )
        └── CommandHandlerCollector creates 'command.handle' span
            └── internally times aggregateStream, sets eventStore.read.duration_ms on span
            └── internally times appendToStream, sets eventStore.append.duration_ms on span
            └── stamps produced events with traceId/spanId from span.spanContext()
```

The collector owns the root scope. Internal operations (event store read, append, decide) use `scope.scope(name, fn)` to create child scopes. Each child scope's `setAttributes()` respects `attributePlacement` config. No manual context threading — the scope carries the root span reference internally.

For Express/Hono, the `on()` handler wrapper creates the root span and passes observability through to handleCommand via options. No request mutation, no `__emmettSpan`.

### Mechanism 2: Message metadata (async boundary)

When events are stored, they carry trace context in metadata: `traceId`, `spanId`, `correlationId`, `causationId`. When a processor reads those events later, the collector reads the metadata and creates spans based on the `propagation` config:

**`propagation: 'links'` (default):**
```
Command handler (Trace A) → produces events with metadata { traceId: A, spanId: x }
    ↓ (async gap — events stored in event store)
Processor (Trace B) → reads events → creates fresh trace B
    → adds SpanLink { traceId: A, spanId: x } to processor span
    → traces A and B are independent, linked for navigation
```

**`propagation: 'propagate'`:**
```
Command handler (Trace A) → produces events with metadata { traceId: A, spanId: x }
    ↓ (async gap — events stored in event store)
Processor (Trace A) → reads events → creates child span under trace A
    → sets parentSpanId: x
    → trace A now spans the async boundary
```

The `propagation` setting is on `ObservabilityOptions`. User chooses based on their needs:
- `'links'`: better for high-throughput systems, keeps traces short, avoids mega-traces
- `'propagate'`: better for debugging flows end-to-end, sees full causal chain in one trace

Both modes use the same message metadata. The difference is only in how the processor collector creates its span.

### How OTel nesting works

When the user plugs in `otelTracer()`, each `startSpan` call creates a real OTel span via `@opentelemetry/api`. OTel's own `startActiveSpan` uses AsyncLocalStorage internally to nest spans — so if handleCommand is called inside an HTTP handler's `startSpan`, OTel automatically makes the `command.handle` span a child of the HTTP span. emmett doesn't manage this — it's OTel's built-in behavior.

For strategies without their own context management (Pino, ClickHouse, noop), spans are flat — no parent-child nesting. Each `startSpan` call is independent. Wide event attributes on the main span still work because the collector passes the span explicitly through its internal operations.

---

## Phase 4: Domain Collectors

Domain collectors are the emmett-built components that compose Tracer + Meter to instrument specific archetypes. Each collector knows what attributes, metrics, and spans matter for its archetype.

Maps to my past sample's `EventStoreMetricsCollector` -- but instead of just metrics, each collector also uses the Tracer for span creation and wide event attributes.

### Step 4.1: CommandHandlerCollector

**File to create:** `src/packages/emmett/src/observability/collectors/commandHandlerCollector.ts`

This collector instruments the `handleCommand` flow using `ObservabilityScope`. It:
- Creates a root scope `command.handle` wrapping the entire command handling
- Sets `emmett.scope.*` semantic attributes for filtering/routing
- Sets `messaging.*` OTel conventions for interoperability
- Sets `emmett.*` domain attributes from the metrics catalog (see feedback.md "Command Handling Metrics"):
  - `emmett.command.type`: string -- derived from the events produced (or from options if provided)
  - `emmett.command.status`: "success" | "failure"
  - `emmett.command.event_count`: number -- count of produced events
  - `emmett.command.event_types`: string[] -- type names of produced events
  - `emmett.command.origin`: string -- where the command came from (http, workflow, reactor) -- set by caller
  - `emmett.command.validation_error`: boolean -- if the error was a validation rejection
  - `error`: boolean -- did any error occur (OTel standard, no prefix)
  - `exception.message`: string -- error message (OTel standard)
  - `exception.type`: string -- error class name (OTel standard)
  - `emmett.stream.name`: string -- the target stream
  - `emmett.stream.type`: string -- stream category (derived from stream name, e.g. "BankAccount" from "BankAccount-123")
  - `emmett.stream.version.before`: number -- version before append
  - `emmett.stream.version.after`: number -- version after append
- Records metrics:
  - `emmett.command.handling.duration` histogram with `{ emmett.command.type, emmett.command.status }` attributes
  - `emmett.event.appending.count` counter, incremented per event with `{ emmett.event.type, emmett.stream.type }` attributes
- Auto-populates `traceId` and `spanId` on produced events from the active span context
- Auto-populates `correlationId` and `causationId` on produced events

The collector is a function, not a class. It uses `createScope` and returns a `startScope` wrapper that sets up the semantic attributes:

```typescript
type CommandHandlerCollectorContext = {
  streamName: string;
  origin?: string;
};

const commandHandlerCollector = (
  observability: ResolvedCommandObservability,
) => {
  const { startScope } = createScope(observability);
  const A = EmmettAttributes;
  const M = MessagingAttributes;
  const commandHandlingDuration = observability.meter.histogram(EmmettMetrics.command.handlingDuration);
  const eventAppendingCount = observability.meter.counter(EmmettMetrics.event.appendingCount);

  return {
    startScope: <T>(
      context: CommandHandlerCollectorContext,
      fn: (scope: ObservabilityScope) => Promise<T>,
    ): Promise<T> => {
      const streamType = context.streamName.split('-')[0] ?? context.streamName;

      return startScope('command.handle', async (scope) => {
        // EmmettAttributes.scope.main=true is set automatically by createScope
        scope.span.setAttributes({
          [A.scope.type]: ScopeTypes.command,
          [A.scope.name]: streamType,
          [A.stream.name]: context.streamName,
          [A.stream.type]: streamType,
          [M.system]: MessagingSystemName,
          [M.destinationName]: context.streamName,
          ...(context.origin ? { [A.command.origin]: context.origin } : {}),
        });

        const startTime = Date.now();
        try {
          const result = await fn(scope);
          scope.span.setAttributes({ [A.command.status]: 'success', error: false });
          return result;
        } catch (err) {
          scope.span.setAttributes({
            [A.command.status]: 'failure',
            error: true,
            'exception.message': err instanceof Error ? err.message : String(err),
            'exception.type': err instanceof Error ? err.constructor.name : 'unknown',
          });
          scope.span.recordException(err instanceof Error ? err : new Error(String(err)));
          throw err;
        } finally {
          const duration = Date.now() - startTime;
          commandHandlingDuration.record(duration, {
            [A.stream.type]: streamType,
          });
        }
      });
    },

    recordEvents: (scope: ObservabilityScope, events: Event[], streamType: string) => {
      scope.span.setAttributes({
        [A.command.eventCount]: events.length,
        [A.command.eventTypes]: events.map(e => e.type),
        [M.batchMessageCount]: events.length,
      });
      for (const event of events) {
        eventAppendingCount.add(1, {
          [A.event.type]: event.type,
          [A.stream.type]: streamType,
        });
      }
    },

    recordVersions: (scope: ObservabilityScope, before: bigint, after: bigint) => {
      scope.span.setAttributes({
        [A.stream.versionBefore]: Number(before),
        [A.stream.versionAfter]: Number(after),
      });
    },
  };
};
```

**File to create:** `src/packages/emmett/src/observability/collectors/commandHandlerCollector.unit.spec.ts`

Tests to write (use a "collecting" tracer and meter that capture calls for assertion):

1. `creates a span named command.handle` -- startScope a fn, verify collecting tracer received span name 'command.handle'.
2. `sets emmett.scope.type, emmett.scope.main, emmett.scope.name on root span` -- verify semantic attributes.
3. `sets emmett.stream.name and emmett.stream.type attributes` -- verify attributes set on the span.
4. `sets messaging.system and messaging.destination.name` -- verify OTel conventions.
5. `sets emmett.command.status to success on success` -- verify attribute.
6. `sets emmett.command.status to failure and error attributes on error` -- throw inside fn, verify error attributes.
7. `records emmett.command.handling.duration histogram` -- verify collecting meter's histogram received a record call with duration > 0.
8. `recordEvents sets emmett.command.event_count, emmett.command.event_types, messaging.batch.message_count and increments counter per event` -- call recordEvents with 2 events, verify counter called twice, attributes set.
9. `recordVersions sets emmett.stream.version.before and emmett.stream.version.after` -- verify attributes.
10. `scope.scope creates child scopes with placement-aware attributes` -- use placement='wide', verify child attributes land on root span.
11. `works with noop observability (no errors)` -- pass resolveCommandObservability(undefined), everything runs without error.

Helper: create a `collectingTracer` and `collectingMeter` for tests -- put these in `src/packages/emmett/src/observability/testing.ts`:

```typescript
const collectingTracer = () => {
  const spans: { name: string; attributes: Record<string, unknown> }[] = [];
  const tracer: EmmettTracer = {
    startSpan: async (name, fn) => {
      const attrs: Record<string, unknown> = {};
      const span: ActiveSpan = {
        setAttributes: (a) => Object.assign(attrs, a),
        spanContext: () => ({ traceId: 'test-trace-id', spanId: 'test-span-id' }),
        addLink: () => {},
        addEvent: () => {},
        recordException: () => {},
      };
      try {
        return await fn(span);
      } finally {
        spans.push({ name, attributes: attrs });
      }
    },
  };
  return { tracer, spans };
};

const collectingMeter = () => {
  const counters: { name: string; value: number; attributes?: Record<string, unknown> }[] = [];
  const histograms: { name: string; value: number; attributes?: Record<string, unknown> }[] = [];
  const gauges: { name: string; value: number; attributes?: Record<string, unknown> }[] = [];
  const meter: EmmettMeter = {
    counter: (name) => ({ add: (v, a) => counters.push({ name, value: v, attributes: a }) }),
    histogram: (name) => ({ record: (v, a) => histograms.push({ name, value: v, attributes: a }) }),
    gauge: (name) => ({ record: (v, a) => gauges.push({ name, value: v, attributes: a }) }),
  };
  return { meter, counters, histograms, gauges };
};
```

### Step 4.2: Wire CommandHandlerCollector into handleCommand

**File to modify:** `src/packages/emmett/src/commandHandling/handleCommand.ts`

In the `CommandHandler` function (line 92-220):

1. At the start of the async retry callback (line 109), resolve observability: `const o11y = resolveCommandObservability(options);`
2. Create collector: `const collector = commandHandlerCollector(o11y);`
3. Wrap the entire session callback in `collector.startScope({ streamName }, async (scope) => { ... })`:
   - Use `scope.scope('eventStore.readStream', ...)` for the aggregation call
   - Use `scope.scope('decide', ...)` for the business logic
   - Use `scope.scope('eventStore.appendToStream', ...)` for the append
   - After all sub-operations: `collector.recordEvents(scope, eventsToAppend, streamType)`
   - After append: `collector.recordVersions(scope, currentStreamVersion, appendResult.nextExpectedStreamVersion)`
   - Before append: stamp events with `traceId` and `spanId` from `scope.span.spanContext()`

4. Stamp correlationId/causationId on produced events:
   - `causationId`: from handleOptions or auto-generated UUID
   - `correlationId`: from handleOptions or auto-generated UUID
   - `traceId`: from `scope.span.spanContext().traceId`
   - `spanId`: from `scope.span.spanContext().spanId`

**Test:** `src/packages/emmett/src/commandHandling/handleCommand.observability.unit.spec.ts`

1. `handleCommand with collecting tracer produces command.handle span` -- use in-memory event store + collecting tracer, handle a command, verify span exists.
2. `handleCommand root span has emmett.scope.type=command and emmett.scope.main=true` -- verify semantic attributes for filtering/routing.
3. `handleCommand root span has messaging.system=emmett and messaging.destination.name` -- verify OTel conventions.
4. `handleCommand span has correct emmett.* attributes after success` -- verify emmett.stream.name, emmett.command.event_count, emmett.command.event_types, emmett.command.status, emmett.stream.version.before/after.
5. `handleCommand creates child spans for eventStore.readStream, decide, eventStore.appendToStream` -- verify three child spans exist.
6. `handleCommand with placement=wide puts child attributes on root span` -- verify emmett.eventstore.read.event_count on root, not on child.
7. `handleCommand with placement=tree puts child attributes on child spans` -- verify emmett.eventstore.read.event_count on child, not on root.
8. `handleCommand span has error attributes on failure` -- make the decide function throw, verify error attributes.
9. `handleCommand records emmett.command.handling.duration histogram` -- verify collecting meter histogram entry.
10. `handleCommand records emmett.event.appending.count counter per event` -- verify collecting meter counter entries.
11. `handleCommand stamps traceId and spanId on produced events` -- read stream, verify events have traceId and spanId in metadata.
12. `handleCommand stamps correlationId on produced events` -- verify.
13. `handleCommand without observability options works (noop, no errors)` -- call without observability, everything works as before.

### Step 4.3: EventStoreCollector

**File to create:** `src/packages/emmett/src/observability/collectors/eventStoreCollector.ts`

Instruments event store operations. Maps directly to past sample's `EventStoreMetricsCollector`. All emmett-specific attributes use the `emmett.` prefix; OTel messaging conventions keep their standard names.

For `readStream`:
- Span: `eventStore.readStream`
- Attributes: `emmett.eventstore.operation: "readStream"`, `emmett.stream.name`, `emmett.stream.type`, `emmett.eventstore.read.event_count`, `emmett.eventstore.read.event_types`, `emmett.eventstore.read.status`, `messaging.operation.type: "receive"`, `messaging.destination.name`
- Metrics: `emmett.stream.reading.duration` histogram with `{ emmett.stream.type, emmett.eventstore.read.status }`, `emmett.stream.reading.size` histogram with `{ emmett.stream.type }`, `emmett.event.reading.count` counter per event with `{ emmett.event.type, emmett.stream.type }`

For `appendToStream`:
- Span: `eventStore.appendToStream`
- Attributes: `emmett.eventstore.operation: "appendToStream"`, `emmett.stream.name`, `emmett.stream.type`, `emmett.eventstore.append.batch_size`, `emmett.eventstore.append.status`, `emmett.stream.version.before`, `emmett.stream.version.after`, `messaging.operation.type: "send"`, `messaging.batch.message_count`, `messaging.destination.name`
- Metrics: `emmett.stream.appending.duration` histogram with `{ emmett.stream.type, emmett.eventstore.append.status }`, `emmett.stream.appending.size` histogram with `{ emmett.stream.type }`, `emmett.event.appending.count` counter per event with `{ emmett.event.type, emmett.stream.type }`

These metric names map to past sample's:
- `matching.stream.reading.duration` -> `emmett.stream.reading.duration`
- `matching.stream.appending.duration` -> `emmett.stream.appending.duration`
- `matching.stream.appending.size` -> `emmett.stream.appending.size`
- `matching.event.appending.count` -> `emmett.event.appending.count`
- `matching.event.reading.count` -> `emmett.event.reading.count`

(Dropped the `matching.` prefix since past sample used it for their specific domain. Added `emmett.` prefix per OTel custom namespace convention.)

```typescript
const eventStoreCollector = (observability: ResolvedCommandObservability) => {
  const A = EmmettAttributes;
  const M = MessagingAttributes;
  const streamReadingDuration = observability.meter.histogram(EmmettMetrics.stream.readingDuration);
  const streamReadingSize = observability.meter.histogram(EmmettMetrics.stream.readingSize);
  const eventReadingCount = observability.meter.counter(EmmettMetrics.event.readingCount);
  const streamAppendingDuration = observability.meter.histogram(EmmettMetrics.stream.appendingDuration);
  const streamAppendingSize = observability.meter.histogram(EmmettMetrics.stream.appendingSize);
  const eventAppendingCount = observability.meter.counter(EmmettMetrics.event.appendingCount);

  return {
    instrumentRead: <T>(streamName: string, fn: (span: ActiveSpan) => Promise<T>): Promise<T> =>
      observability.tracer.startSpan('eventStore.readStream', async (span) => {
        const streamType = streamName.split('-')[0] ?? streamName;
        span.setAttributes({
          [A.eventStore.operation]: 'readStream',
          [A.stream.name]: streamName,
          [A.stream.type]: streamType,
          [M.operationType]: 'receive',
          [M.destinationName]: streamName,
        });
        // ... timing, error handling, metrics recording
      }),

    instrumentAppend: <T>(streamName: string, events: Event[], fn: (span: ActiveSpan) => Promise<T>): Promise<T> =>
      observability.tracer.startSpan('eventStore.appendToStream', async (span) => {
        span.setAttributes({
          [A.eventStore.operation]: 'appendToStream',
          [A.stream.name]: streamName,
          [M.operationType]: 'send',
          [M.batchMessageCount]: events.length,
          [M.destinationName]: streamName,
        });
        // ... similar pattern
      }),
  };
};
```

**File to create:** `src/packages/emmett/src/observability/collectors/eventStoreCollector.unit.spec.ts`

Tests (similar pattern to CommandHandlerCollector tests):

1. `instrumentRead creates eventStore.readStream span with emmett.eventstore.operation and messaging.operation.type attributes`
2. `instrumentRead records emmett.stream.reading.duration histogram on success`
3. `instrumentRead records emmett.stream.reading.duration histogram on failure with emmett.eventstore.read.status=failure`
4. `instrumentRead records emmett.event.reading.count counter per event type`
5. `instrumentRead records emmett.stream.reading.size histogram`
6. `instrumentAppend creates eventStore.appendToStream span with emmett.* and messaging.* attributes`
7. `instrumentAppend records emmett.stream.appending.duration, emmett.stream.appending.size, emmett.event.appending.count`
8. `instrumentAppend records emmett.stream.version.before and emmett.stream.version.after`
9. `works with noop observability`

### Step 4.4: Wire EventStoreCollector into event store

The EventStoreCollector creates child scopes (`eventStore.readStream`, `eventStore.appendToStream`) under the main `command.handle` root scope. The CommandHandlerCollector uses `scope.scope(name, fn)` for each sub-operation, which creates a child span via `tracer.startSpan`. If the user plugs in OTel, OTel's AsyncLocalStorage auto-nests them. For other strategies (Pino, ClickHouse, noop), child spans are independent.

The collector is wired into handleCommand (option b from past sample's architecture) — the CommandHandlerCollector wraps eventStore calls via `scope.scope()`. No separate MetricsEventStoreWrapper. If standalone event store instrumentation (outside command handling) is needed later, we can add the wrapper pattern then.

### Step 4.5: ProcessorCollector

**File to create:** `src/packages/emmett/src/observability/collectors/processorCollector.ts`

Instruments processor message handling using `ObservabilityScope`. Attributes from the metrics catalog (see feedback.md "Processor Metrics"):

- Root scope: `processor.handle`
- Semantic attributes: `emmett.scope.type: 'processor'`, `emmett.scope.main: true`, `emmett.scope.name: processorId`
- Domain attributes:
  - `emmett.processor.id`: string -- from processor config
  - `emmett.processor.type`: "projector" | "reactor" | "workflow" | "custom" -- from processor config
  - `emmett.processor.batch_size`: number -- count of messages in this batch
  - `emmett.processor.event_types`: string[] -- event types in batch
  - `emmett.processor.status`: "ack" | "skip" | "stop" | "error" -- from handler result
  - `emmett.processor.checkpoint.before`: string -- checkpoint position before processing
  - `emmett.processor.checkpoint.after`: string -- checkpoint position after processing
  - `emmett.processor.lag_events`: number -- how far behind latest position
- OTel messaging conventions:
  - `messaging.system: 'emmett'`
  - `messaging.consumer.group.name`: processorId
  - `messaging.batch.message_count`: batch size
  - Per-message child scopes: `messaging.operation.type: 'process'`, `messaging.message.id`
  - Links OR parentSpanId: based on `propagation` config, extracted from event metadata's traceId/spanId
- Metrics:
  - `emmett.processor.processing.duration` histogram with `{ emmett.processor.id, emmett.processor.type, emmett.processor.status }`
  - `emmett.processor.lag_events` gauge with `{ emmett.processor.id }`

```typescript
const processorCollector = (observability: ResolvedProcessorObservability) => {
  const { startScope } = createScope(observability);
  const A = EmmettAttributes;
  const M = MessagingAttributes;
  const processingDuration = observability.meter.histogram(EmmettMetrics.processor.processingDuration);
  const lagEvents = observability.meter.gauge(EmmettMetrics.processor.lagEvents);

  return {
    startScope: <T>(
      context: { processorId: string; type: string; checkpoint: ProcessorCheckpoint | null },
      messages: RecordedMessage[],
      fn: (scope: ObservabilityScope) => Promise<T>,
    ): Promise<T> => {
      const sourceTraces = messages
        .filter(m => m.metadata?.traceId && m.metadata?.spanId)
        .map(m => ({ traceId: m.metadata.traceId, spanId: m.metadata.spanId }));

      return startScope('processor.handle', async (scope) => {
        // EmmettAttributes.scope.main=true is set automatically by createScope
        scope.span.setAttributes({
          [A.scope.type]: ScopeTypes.processor,
          [A.scope.name]: context.processorId,
          [A.processor.id]: context.processorId,
          [A.processor.type]: context.type,
          [A.processor.batchSize]: messages.length,
          [A.processor.eventTypes]: [...new Set(messages.map(m => m.type))],
          [M.system]: MessagingSystemName,
          [M.consumerGroupName]: context.processorId,
          [M.batchMessageCount]: messages.length,
          ...(context.checkpoint ? { [A.processor.checkpointBefore]: context.checkpoint } : {}),
        });

        if (observability.propagation === 'links') {
          for (const source of sourceTraces) {
            scope.span.addLink({ traceId: source.traceId, spanId: source.spanId });
          }
        }

        // ... timing, error handling, metrics recording
        return fn(scope);
      });
    },
  };
};
```

Note: this means `startSpan` needs an optional third argument for parent context. Update the `EmmettTracer` interface:

```typescript
type StartSpanOptions = {
  parent?: SpanContext;
};

type EmmettTracer = {
  startSpan<T>(
    name: string,
    fn: (span: ActiveSpan) => Promise<T>,
    options?: StartSpanOptions,
  ): Promise<T>;
};
```

When `parent` is provided:
- OTel strategy: creates span with explicit parent via `context.with(trace.setSpanContext(ctx, parent), ...)`
- Pino/ClickHouse/noop: ignore parent (no nesting support)

This is how the propagation config actually reaches the tracer — through explicit `StartSpanOptions`, not through ambient state.

**File to create:** `src/packages/emmett/src/observability/collectors/processorCollector.unit.spec.ts`

Tests:

1. `creates processor.handle span with emmett.scope.type=processor and emmett.scope.main=true`
2. `sets emmett.processor.id, emmett.processor.type, emmett.processor.batch_size`
3. `sets messaging.system, messaging.consumer.group.name, messaging.batch.message_count`
4. `sets emmett.processor.event_types from message types`
5. `adds SpanLinks from message metadata traceId/spanId when propagation=links`
6. `creates child scopes per message with messaging.operation.type=process`
7. `records emmett.processor.processing.duration histogram`
8. `records emmett.processor.lag_events gauge`
9. `sets emmett.processor.status based on handler result`
10. `works with noop observability`

### Step 4.6: Wire ProcessorCollector into reactor/projector

**File to modify:** `src/packages/emmett/src/processors/processors.ts`

In the `reactor` function (line 292), in the `handle` method (line 418-487):

1. Resolve observability from options: `const o11y = resolveProcessorObservability(options);`
2. Create collector: `const collector = processorCollector(o11y);`
3. Wrap the batch processing in `collector.startScope(...)`.

The `handle` method receives `messages` and `partialContext`. Wrap the processing in the collector's scope:

```typescript
handle: async (messages, partialContext) => {
  if (!isActive) return Promise.resolve();
  const A = EmmettAttributes;
  const M = MessagingAttributes;
  return collector.startScope(
    { processorId, type, checkpoint: lastCheckpoint },
    messages,
    async (scope) => {
      // Per-message child scopes
      for (const message of messages) {
        await scope.scope(`processor.message.${message.type}`, async (child) => {
          child.span.setAttributes({
            [M.operationType]: 'process',
            [M.messageId]: message.metadata?.messageId,
          });
          await eachMessage(message, context);
        });
      }
      scope.span.setAttributes({ [A.processor.status]: result?.type ?? 'ack' });
      return result;
    },
  );
},
```

### Step 4.7: WorkflowCollector

**File to create:** `src/packages/emmett/src/observability/collectors/workflowCollector.ts`

Instruments workflow steps using `ObservabilityScope`. Attributes from the metrics catalog (see feedback.md "Workflow-Specific Metrics"):

- Root scope: `workflow.step`
- Semantic attributes: `emmett.scope.type: 'workflow'`, `emmett.scope.main: true`, `emmett.scope.name: workflowType`
- Domain attributes:
  - `emmett.workflow.id`: string -- workflow instance ID (from router)
  - `emmett.workflow.type`: string -- workflow definition name
  - `emmett.workflow.input.type`: string -- what message triggered this step
  - `emmett.workflow.step`: string -- "route" | "decide" | "evolve"
  - `emmett.workflow.state.status`: string -- current state after processing
  - `emmett.workflow.state.transition`: string -- "Pending -> Finished"
  - `emmett.workflow.outputs`: string[] -- output message types
  - `emmett.workflow.outputs.count`: number
  - `emmett.workflow.stream_position`: number -- position in workflow stream
  - `emmett.workflow.decide.duration_ms`: number -- time in decide function
  - `emmett.workflow.evolve.duration_ms`: number -- time rebuilding state
  - `emmett.workflow.state_rebuild.event_count`: number -- events replayed to rebuild state
  - Links: SpanLink[] -- back to originating trace from input event metadata
- OTel messaging: `messaging.system: 'emmett'`
- Metrics:
  - `emmett.workflow.processing.duration` histogram with `{ emmett.workflow.type, emmett.workflow.step }`

**File to create:** `src/packages/emmett/src/observability/collectors/workflowCollector.unit.spec.ts`

Tests:

1. `creates workflow.step scope with emmett.scope.type=workflow and emmett.scope.main=true`
2. `sets emmett.workflow.id, emmett.workflow.type, emmett.workflow.input.type`
3. `sets emmett.workflow.outputs and emmett.workflow.outputs.count`
4. `creates child scopes for evolve/decide/route with placement-aware attributes`
5. `records emmett.workflow.processing.duration histogram`
6. `adds SpanLink from input event metadata`
7. `works with noop observability`

### Step 4.8: Wire WorkflowCollector into handleWorkflow

**File to modify:** `src/packages/emmett/src/workflows/handleWorkflow.ts`

In `WorkflowHandler` (line 185), wrap the session callback in the collector's `startScope`. Use `scope.scope('workflow.evolve', ...)` for the `aggregateStream` call and `scope.scope('workflow.decide', ...)` for the business logic. Child scope attributes (e.g., `emmett.workflow.evolve.duration_ms`, `emmett.workflow.state_rebuild.event_count`) respect `attributePlacement` config.

### Step 4.9: ConsumerCollector + Puller Instrumentation

**File to create:** `src/packages/emmett/src/observability/collectors/consumerCollector.ts`

#### Design: Polling loop vs batch processing — separate concerns

The consumer has two distinct layers:

1. **Puller** (`messageBatchPuller`) — infrastructure loop: poll DB, sleep, backoff. Lives in `emmett-postgresql`/`emmett-sqlite`.
2. **Consumer** (`eachBatch`) — fans out batches to processors. Each processor creates its own root span with links.

The puller is NOT a parent of processor work. Processors create independent traces (with links back to producers via message metadata). The puller's spans, when enabled, are sibling infrastructure traces — operational telemetry about the polling mechanics.

#### `pollTracing` controls puller visibility

Resolved from `ConsumerObservabilityConfig` (which only exposes `tracer`, `meter`, `pollTracing`):

- **`'off'`** (default) — puller creates no spans. Processors get their own root spans as usual. Metrics still recorded (poll duration histogram, lag gauge) because metrics are cheap.
- **`'active'`** — span per poll iteration that found messages. Attributes: batch size, query duration, position after. Empty polls are silent.
- **`'verbose'`** — every poll iteration. Empty polls get `emmett.consumer.poll.empty: true` with backoff timing (`emmett.consumer.poll.wait_ms`).

Poll spans are always root spans (fresh trace, `emmett.scope.main: true`). They are NOT parents of processor spans.

#### Attributes

Consumer-level (on poll spans when enabled, always on metrics):
- `emmett.scope.type: 'consumer'`, `emmett.scope.main: true`
- `emmett.consumer.source`: string -- "postgresql" or "sqlite"
- `emmett.consumer.batch_size`: number -- messages fetched this cycle (0 for empty polls)
- `emmett.consumer.processor_count`: number -- active processors
- `emmett.consumer.earliest_checkpoint`: string -- lowest checkpoint across processors
- `emmett.consumer.lag`: number -- latest global position - earliest checkpoint
- `emmett.consumer.poll.empty`: boolean -- true when no messages found (verbose mode only)
- `emmett.consumer.poll.wait_ms`: number -- backoff wait time before next poll
- `messaging.system: 'emmett'`, `messaging.operation.type: 'receive'`

Per-processor delivery (child scopes of the poll span, only when poll span exists):
- `emmett.consumer.delivery.processor_id`: string
- `emmett.consumer.delivery.status`: "success" | "error"
- `messaging.consumer.group.name`: processorId

#### Span links: established at processor level, not consumer level

The consumer does NOT add span links. It doesn't know about producer traces — that's the processor's job. Each processor's `processorCollector.startScope` extracts `traceId`/`spanId` from message metadata and adds links (already defined in Step 4.5).

This means the trace topology looks like:

```
[Poll trace — infrastructure, optional]
Span: "consumer.poll"
  emmett.scope.main: true
  emmett.consumer.batch_size: 25
  emmett.consumer.poll.empty: false
  (no links — this is plumbing)

[Processor traces — independent, one per processor per batch]
Span: "processor.handle" (Trace B — independent root)
  emmett.scope.main: true
  emmett.processor.id: "ShoppingCartProjection"
  links: [{ traceId: A1, spanId: x1 }, { traceId: A2, spanId: x2 }]  ← from message metadata
  └── Span: "processor.message.OrderPlaced"
  └── Span: "processor.message.ItemAdded"

Span: "processor.handle" (Trace C — independent root)
  emmett.scope.main: true
  emmett.processor.id: "OrderWorkflow"
  links: [{ traceId: A1, spanId: x1 }]
  └── Span: "processor.message.OrderPlaced"
```

The poll span and processor spans are NOT in a parent-child relationship. They happen to be triggered by the same poll cycle, but they're in separate traces. If you need to correlate them, use timestamps or add a shared `emmett.consumer.poll_id` attribute (a UUID per poll iteration).

#### Collector implementation

```typescript
const consumerCollector = (observability: ResolvedConsumerObservability) => {
  const { startScope } = createScope(observability);
  const A = EmmettAttributes;
  const M = MessagingAttributes;
  const pollDuration = observability.meter.histogram(EmmettMetrics.consumer.pollDuration);
  const deliveryDuration = observability.meter.histogram(EmmettMetrics.consumer.deliveryDuration);

  return {
    // Called per poll iteration by the puller.
    // Returns whether to create a span based on pollTracing config.
    shouldTrace: (messageCount: number): boolean => {
      if (observability.pollTracing === 'off') return false;
      if (observability.pollTracing === 'active') return messageCount > 0;
      return true; // 'verbose'
    },

    // Wraps a poll iteration in a span (only called when shouldTrace returns true).
    tracePoll: <T>(
      context: {
        source: string;
        processorCount: number;
        batchSize: number;
        earliestCheckpoint: string | null;
        lag: number | null;
        empty: boolean;
        waitMs?: number;
      },
      fn: (scope: ObservabilityScope) => Promise<T>,
    ): Promise<T> =>
      startScope('consumer.poll', async (scope) => {
        scope.span.setAttributes({
          [A.scope.type]: ScopeTypes.consumer,
          [A.scope.name]: context.source,
          [A.consumer.source]: context.source,
          [A.consumer.batchSize]: context.batchSize,
          [A.consumer.processorCount]: context.processorCount,
          [M.system]: MessagingSystemName,
          [M.operationType]: 'receive',
          ...(context.earliestCheckpoint ? { [A.consumer.earliestCheckpoint]: context.earliestCheckpoint } : {}),
          ...(context.lag != null ? { [A.consumer.lag]: context.lag } : {}),
          ...(context.empty ? { ['emmett.consumer.poll.empty']: true } : {}),
          ...(context.waitMs != null ? { ['emmett.consumer.poll.wait_ms']: context.waitMs } : {}),
        });

        return fn(scope);
      }),

    // Records metrics (always, regardless of pollTracing).
    recordPollMetrics: (durationMs: number, attrs: Record<string, unknown>) => {
      pollDuration.record(durationMs, attrs);
    },

    // Wraps per-processor delivery in a child scope.
    traceDelivery: <T>(
      scope: ObservabilityScope,
      processorId: string,
      fn: () => Promise<T>,
    ): Promise<T> =>
      scope.scope(`consumer.deliver.${processorId}`, async (child) => {
        child.span.setAttributes({
          [A.consumer.delivery.processorId]: processorId,
          [M.consumerGroupName]: processorId,
        });
        try {
          const result = await fn();
          child.span.setAttributes({ [A.consumer.delivery.status]: 'success' });
          return result;
        } catch (error) {
          child.span.setAttributes({ [A.consumer.delivery.status]: 'error' });
          if (error instanceof Error) child.span.recordException(error);
          throw error;
        }
      }),
  };
};
```

#### Wiring into the puller

The puller (`postgreSQLEventStoreMessageBatchPuller` / `sqliteEventStoreMessageBatchPuller`) accepts an optional `observability` parameter typed as `ConsumerObservabilityConfig`. The `pullMessages` loop uses the collector:

```typescript
// In the pullMessages while loop:
while (isRunning && !signal?.aborted) {
  const start = Date.now();
  const { messages, currentGlobalPosition, areMessagesLeft } =
    await readMessagesBatch(executor, readMessagesOptions);

  const durationMs = Date.now() - start;
  collector.recordPollMetrics(durationMs, { [A.consumer.source]: 'postgresql' });

  if (collector.shouldTrace(messages.length)) {
    await collector.tracePoll(
      {
        source: 'postgresql',
        batchSize: messages.length,
        processorCount: activeProcessorCount,
        earliestCheckpoint: null, // consumer tracks this
        lag: null,
        empty: messages.length === 0,
        waitMs: waitTime,
      },
      async (scope) => {
        if (messages.length > 0) {
          // eachBatch is NOT wrapped in a child span here —
          // each processor inside eachBatch creates its own root trace.
          await eachBatch(messages);
        }
        return undefined;
      },
    );
  } else if (messages.length > 0) {
    // pollTracing=off but still process the batch
    await eachBatch(messages);
  }

  readMessagesOptions.after = currentGlobalPosition;
  // ... backoff logic unchanged
}
```

**File to create:** `src/packages/emmett/src/observability/collectors/consumerCollector.unit.spec.ts`

Tests:

1. `shouldTrace returns false for empty polls when pollTracing=off`
2. `shouldTrace returns false for non-empty polls when pollTracing=off`
3. `shouldTrace returns false for empty polls when pollTracing=active`
4. `shouldTrace returns true for non-empty polls when pollTracing=active`
5. `shouldTrace returns true for empty polls when pollTracing=verbose`
6. `shouldTrace returns true for non-empty polls when pollTracing=verbose`
7. `tracePoll creates consumer.poll span with emmett.scope.type=consumer and emmett.scope.main=true`
8. `tracePoll sets emmett.consumer.source, emmett.consumer.batch_size, emmett.consumer.processor_count`
9. `tracePoll sets messaging.system=emmett and messaging.operation.type=receive`
10. `tracePoll sets emmett.consumer.poll.empty=true for empty polls`
11. `tracePoll sets emmett.consumer.poll.wait_ms for backoff timing`
12. `traceDelivery creates child scope per processor with emmett.consumer.delivery.processor_id`
13. `traceDelivery sets delivery status=success on success`
14. `traceDelivery sets delivery status=error and records exception on failure`
15. `recordPollMetrics records emmett.consumer.poll.duration histogram regardless of pollTracing`
16. `works with noop observability`

### Step 4.10: Collector index + exports

**File to create:** `src/packages/emmett/src/observability/collectors/index.ts`

```typescript
export * from './commandHandlerCollector';
export * from './eventStoreCollector';
export * from './processorCollector';
export * from './workflowCollector';
export * from './consumerCollector';
```

**File to modify:** `src/packages/emmett/src/observability/index.ts` -- add `export * from './collectors';`

**Run:** All tests pass. `npx tsc --noEmit` passes.

---

## Phase 5: OTel Strategy Implementations

### Step 5.1: OTel Tracer

**File to create:** `src/packages/emmett/src/observability/strategies/otelTracer.ts`

Creates real OTel spans via `@opentelemetry/api`. This file is the ONLY place in emmett that imports `@opentelemetry/api` for tracing.

```typescript
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

const otelTracer = (tracerName = 'emmett'): EmmettTracer => ({
  startSpan: async (name, fn) => {
    const tracer = trace.getTracer(tracerName);
    return tracer.startActiveSpan(name, async (otelSpan) => {
      const span: ActiveSpan = {
        setAttributes: (attrs) => {
          for (const [key, value] of Object.entries(attrs)) {
            if (value !== undefined) {
              otelSpan.setAttribute(key, value as string | number | boolean);
            }
          }
        },
        spanContext: () => ({
          traceId: otelSpan.spanContext().traceId,
          spanId: otelSpan.spanContext().spanId,
        }),
        addLink: () => {
          // OTel API doesn't support adding links after span creation
          // Links must be passed at creation time -- this is a known limitation
        },
      };
      try {
        const result = await fn(span);
        otelSpan.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        otelSpan.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
        otelSpan.recordException(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        otelSpan.end();
      }
    });
  },
});
```

Note on addLink: OTel API requires links at span creation. To support this, we may need to buffer links during the fn execution and pass them to the next span. Or accept this limitation for the OTel strategy and document it. The noop and ClickHouse strategies don't have this limitation.

**File to create:** `src/packages/emmett/src/observability/strategies/otelTracer.unit.spec.ts`

Tests (these require `@opentelemetry/api` as a dev dependency):

1. `creates a span via OTel API` -- set up in-memory span exporter, call otelTracer().startSpan('test', ...), verify span was created with correct name.
2. `setAttributes maps to OTel span.setAttribute` -- verify attributes on exported span.
3. `spanContext returns real OTel traceId and spanId` -- verify they are valid hex strings (32 chars and 16 chars respectively).
4. `nested startSpan creates parent-child relationship` -- start outer span, inside it start inner span, verify inner span has outer's spanId as parentSpanId.
5. `sets ERROR status on exception` -- throw inside fn, verify span has error status.

**Dependencies:** Add `@opentelemetry/api` as a **peer dependency** (not a direct dependency) to emmett's package.json. Users who want OTel bring their own SDK.

### Step 5.2: OTel Meter

**File to create:** `src/packages/emmett/src/observability/strategies/otelMeter.ts`

```typescript
import { metrics } from '@opentelemetry/api';

const otelMeter = (meterName = 'emmett'): EmmettMeter => {
  const meter = metrics.getMeter(meterName);
  return {
    counter: (name) => {
      const counter = meter.createCounter(name);
      return { add: (value, attrs) => counter.add(value, attrs) };
    },
    histogram: (name) => {
      const histogram = meter.createHistogram(name);
      return { record: (value, attrs) => histogram.record(value, attrs) };
    },
    gauge: (name) => {
      const gauge = meter.createGauge(name);
      return { record: (value, attrs) => gauge.record(value, attrs) };
    },
  };
};
```

**File to create:** `src/packages/emmett/src/observability/strategies/otelMeter.unit.spec.ts`

Tests:

1. `counter.add creates an OTel counter and calls add`
2. `histogram.record creates an OTel histogram and calls record`
3. `gauge.record creates an OTel gauge and calls record`

### Step 5.3: Strategy index + exports

**File to create:** `src/packages/emmett/src/observability/strategies/index.ts`

```typescript
export * from './otelTracer';
export * from './otelMeter';
```

**File to modify:** `src/packages/emmett/src/observability/index.ts` -- add `export * from './strategies';`

---

## Phase 6: Pino Tracer Strategy

Pino as a tracer strategy — `addEvent` emits structured log lines via Pino, `recordException` logs at error level. The span itself is logged on completion with timing and attributes.

### Step 6.1: Pino Tracer

**File to create:** `src/packages/emmett/src/observability/strategies/pinoTracer.ts`

User passes their own Pino instance. The strategy implements `EmmettTracer`:

```typescript
import type { Logger as PinoLogger } from 'pino';

const pinoTracer = (pino: PinoLogger): EmmettTracer => ({
  startSpan: async (name, fn) => {
    const startTime = Date.now();
    const attrs: Record<string, unknown> = {};
    const span: ActiveSpan = {
      setAttributes: (a) => Object.assign(attrs, a),
      spanContext: () => ({ traceId: '', spanId: '' }),
      addLink: () => {},
      addEvent: (eventName, eventAttrs) => pino.info({ ...eventAttrs, spanName: name }, eventName),
      recordException: (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        pino.error({ err: error, spanName: name }, error.message);
      },
    };
    try {
      const result = await fn(span);
      const durationMs = Date.now() - startTime;
      pino.info({ ...attrs, durationMs, status: 'success' }, name);
      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      pino.error({ ...attrs, durationMs, status: 'failure', err }, name);
      throw err;
    }
  },
});
```

**Test:** `src/packages/emmett/src/observability/strategies/pinoTracer.unit.spec.ts`

1. `logs span name and attributes on completion` -- mock Pino, verify pino.info called with attrs and name.
2. `addEvent emits pino.info with event name and attributes`
3. `recordException emits pino.error`
4. `logs at error level on failure`

**Dependency:** `pino` types as a dev/peer dependency.

---

## Phase 7: ClickHouse Tracer Strategy

### Step 7.1: Basic ClickHouse tracer

**File to create:** `src/packages/emmett/src/observability/strategies/clickhouseTracer.ts`

On span completion, calls an insert function with span data flattened as columns. This validates the strategy pattern works for analytical backends.

```typescript
type ClickHouseInsert = (row: {
  name: string;
  startTime: number;
  durationMs: number;
  traceId: string;
  spanId: string;
  attributes: Record<string, unknown>;
  status: 'success' | 'failure';
}) => Promise<void>;

const clickhouseTracer = (insert: ClickHouseInsert): EmmettTracer => ({
  startSpan: async (name, fn) => {
    const startTime = Date.now();
    const traceId = generateTraceId(); // 16-byte hex
    const spanId = generateSpanId();    // 8-byte hex
    const attrs: Record<string, unknown> = {};
    let status: 'success' | 'failure' = 'success';

    const span: ActiveSpan = {
      setAttributes: (a) => Object.assign(attrs, a),
      spanContext: () => ({ traceId, spanId }),
      addLink: () => {},
    };

    try {
      return await fn(span);
    } catch (err) {
      status = 'failure';
      throw err;
    } finally {
      const durationMs = Date.now() - startTime;
      await insert({ name, startTime, durationMs, traceId, spanId, attributes: attrs, status });
    }
  },
});
```

**Test:** `src/packages/emmett/src/observability/strategies/clickhouseTracer.unit.spec.ts`

1. `calls insert function on span completion with correct fields` -- use a mock insert that captures the row, verify fields.
2. `captures all attributes set during execution`
3. `status is failure when fn throws`
4. `generates valid hex traceId (32 chars) and spanId (16 chars)`

---

## Phase 8: HTTP Framework Auto-instrumentation

### Step 8.1: Express instrumented handler

**File to modify:** `src/packages/emmett-expressjs/src/handler.ts`

Instead of separate middleware, extend emmett-expressjs's existing `on()` handler wrapper to accept observability options. The `on()` function already wraps route handlers — it's the natural place to create spans.

```typescript
import type { ObservabilityOptions } from '@event-driven-io/emmett';

export const on =
  <RequestType extends Request>(
    handle: HttpHandler<RequestType>,
    options?: ObservabilityOptions,
  ) =>
  async (request: RequestType, response: Response, _next: NextFunction): Promise<void> => {
    // HTTP handlers only need tracer + meter, no archetype-specific config.
    const tracer = options?.observability?.tracer ?? noopTracer();
    const meter = options?.observability?.meter ?? noopMeter();

    await tracer.startSpan(
      `${request.method} ${request.path}`,
      async (span) => {
        span.setAttributes({
          'http.method': request.method,
          'http.url': request.originalUrl,
          'http.route': request.path,
        });

        const setResponse = await Promise.resolve(handle(request));

        // Response carries status code after setting
        setResponse(response);
        span.setAttributes({ 'http.status_code': response.statusCode });
      },
    );
  };
```

No request mutation. No middleware. The span wraps the handler directly. When `handleCommand` is called inside the handler, it receives its own observability options and creates `command.handle` span. If the user plugged in OTel, OTel's internal AsyncLocalStorage nests them automatically. If not, they're independent spans — which is fine because the wide event attributes are on each span.

**Test:** `src/packages/emmett-expressjs/src/handler.observability.unit.spec.ts`

1. `on() with observability creates a span wrapping the handler`
2. `span has http.method, http.url, http.status_code attributes`
3. `on() without observability works as before (noop)`
4. `errors in handler set error attributes on span`

### Step 8.2: Hono instrumented handler

**File to modify:** `src/packages/emmett-honojs/src/handler.ts`

Same pattern — extend the existing handler wrapper to accept `ObservabilityOptions`.

---

## Phase 9: Integration Tests

### Step 9.1: End-to-end: command handler -> event store -> processor with observability

**File to create:** `src/packages/emmett/src/observability/integration.spec.ts`

Full flow test:

1. Configure: `collectingTracer()` + `collectingMeter()` as observability.
2. Set up in-memory event store with observability options.
3. Handle a command via `CommandHandler` with observability. Verify:
   - `command.handle` scope exists with `emmett.scope.type=command`, `emmett.scope.main=true`
   - Child scopes exist for `eventStore.readStream`, `decide`, `eventStore.appendToStream`
   - `emmett.*` domain attributes and `messaging.*` OTel conventions present
   - `emmett.command.handling.duration` histogram recorded
   - `emmett.event.appending.count` counter recorded per event
   - Produced events have `traceId`, `spanId`, `correlationId`, `causationId` in metadata
4. Set up a reactor with observability that receives those events. Verify:
   - `processor.handle` scope exists with `emmett.scope.type=processor`, `emmett.scope.main=true`
   - Child scopes per message with `messaging.operation.type=process`
   - SpanLinks point back to the command's traceId/spanId (from event metadata)
   - `emmett.processor.processing.duration` histogram recorded
5. Verify `composite(tracer1, tracer2)` runs both strategies for the same execution.
6. Verify `attributePlacement=wide` puts child scope attributes on root span only.
7. Verify `attributePlacement=tree` puts child scope attributes on child spans only.

### Step 9.2: Full stack with Express

**File to create:** `src/packages/emmett-expressjs/src/e2e/observability.e2e.spec.ts`

Using supertest:

1. Set up Express app with observability middleware + command handler endpoint.
2. Send HTTP request.
3. Verify span nesting: HTTP span -> command.handle span -> event store operations.
4. Verify http.status_code set on the HTTP span.

---

## Verification Checklist

After each phase:
- [ ] `npx vitest run` -- all new and existing tests pass
- [ ] `npx tsc --noEmit` -- type checking passes
- [ ] No `any` types introduced (use `unknown` instead)
- [ ] All exports flow through index.ts files up to the package root
- [ ] Existing tests still pass without observability configured (noop defaults)

---

## File Summary

### New files to create:

**Interfaces (2 focused interfaces + scope, no separate Logger):**
- `src/packages/emmett/src/observability/tracer.ts` (replaces existing -- EmmettTracer with startSpan, ActiveSpan with setAttributes/addEvent/recordException)
- `src/packages/emmett/src/observability/meter.ts` (EmmettMeter with counter/histogram/gauge)
- `src/packages/emmett/src/observability/composite.ts` (compositeTracer, compositeMeter)
- `src/packages/emmett/src/observability/options.ts` (ObservabilityConfig, ObservabilityOptions, per-archetype configs + resolvers: resolveCommandObservability, resolveProcessorObservability, resolveConsumerObservability, resolveWorkflowObservability)
- `src/packages/emmett/src/observability/scope.ts` (ObservabilityScope, ScopeObservability, createScope -- placement-aware scope with child scope nesting)
- `src/packages/emmett/src/observability/attributes.ts` (EmmettAttributes, MessagingAttributes, EmmettMetrics, ScopeTypes, MessagingSystemName -- all attribute/metric name constants)
- `src/packages/emmett/src/observability/testing.ts` (collectingTracer, collectingMeter for tests)

**Collectors:**
- `src/packages/emmett/src/observability/collectors/index.ts`
- `src/packages/emmett/src/observability/collectors/commandHandlerCollector.ts`
- `src/packages/emmett/src/observability/collectors/eventStoreCollector.ts`
- `src/packages/emmett/src/observability/collectors/processorCollector.ts`
- `src/packages/emmett/src/observability/collectors/workflowCollector.ts`
- `src/packages/emmett/src/observability/collectors/consumerCollector.ts`

**Strategies (all implement EmmettTracer or EmmettMeter -- no separate Logger type):**
- `src/packages/emmett/src/observability/strategies/index.ts`
- `src/packages/emmett/src/observability/strategies/otelTracer.ts` (creates real OTel spans, addEvent -> otelSpan.addEvent, recordException -> otelSpan.recordException)
- `src/packages/emmett/src/observability/strategies/otelMeter.ts` (creates real OTel metrics)
- `src/packages/emmett/src/observability/strategies/pinoTracer.ts` (addEvent -> pino.info, recordException -> pino.error, span completion -> pino.info/error)
- `src/packages/emmett/src/observability/strategies/clickhouseTracer.ts` (span completion -> insert row)

**Test files:**
- `src/packages/emmett/src/observability/tracer.unit.spec.ts`
- `src/packages/emmett/src/observability/meter.unit.spec.ts`
- `src/packages/emmett/src/observability/composite.unit.spec.ts`
- `src/packages/emmett/src/observability/options.unit.spec.ts`
- `src/packages/emmett/src/observability/scope.unit.spec.ts`
- `src/packages/emmett/src/observability/attributes.unit.spec.ts`
- `src/packages/emmett/src/observability/collectors/commandHandlerCollector.unit.spec.ts`
- `src/packages/emmett/src/observability/collectors/eventStoreCollector.unit.spec.ts`
- `src/packages/emmett/src/observability/collectors/processorCollector.unit.spec.ts`
- `src/packages/emmett/src/observability/collectors/workflowCollector.unit.spec.ts`
- `src/packages/emmett/src/observability/collectors/consumerCollector.unit.spec.ts`
- `src/packages/emmett/src/observability/strategies/otelTracer.unit.spec.ts`
- `src/packages/emmett/src/observability/strategies/otelMeter.unit.spec.ts`
- `src/packages/emmett/src/observability/strategies/pinoTracer.unit.spec.ts`
- `src/packages/emmett/src/observability/strategies/clickhouseTracer.unit.spec.ts`
- `src/packages/emmett/src/commandHandling/handleCommand.observability.unit.spec.ts`
- `src/packages/emmett/src/observability/integration.spec.ts`
- `src/packages/emmett-expressjs/src/handler.observability.unit.spec.ts`
- `src/packages/emmett-expressjs/src/e2e/observability.e2e.spec.ts`

### Existing files to modify:

- `src/packages/emmett/src/typing/message.ts` -- add correlationId, causationId, traceId, spanId to CommonRecordedMessageMetadata
- `src/packages/emmett/src/commandHandling/handleCommand.ts` -- add `& ObservabilityOptions`, wire collector, stamp events
- `src/packages/emmett/src/eventStore/eventStore.ts` -- add `& ObservabilityOptions` to ReadStreamOptions, AppendToStreamOptions
- `src/packages/emmett/src/processors/processors.ts` -- add `& ObservabilityOptions` to BaseMessageProcessorOptions, wire collector
- `src/packages/emmett/src/projections/index.ts` -- add `& ObservabilityOptions` to ProjectionDefinition
- `src/packages/emmett/src/observability/index.ts` -- export all new modules
- `src/packages/emmett/src/index.ts` -- add `export * from './observability'` if not present
- `src/packages/emmett/src/workflows/handleWorkflow.ts` -- wire WorkflowCollector
- `src/packages/emmett-expressjs/src/handler.ts` -- extend `on()` to accept ObservabilityOptions, wrap in span
- `src/packages/emmett-honojs/src/handler.ts` -- same pattern for Hono
