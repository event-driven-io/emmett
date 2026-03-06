# Observability Research Summary

## Sources

### Articles
- [Minimal JS Tracing](https://jeremymorrell.dev/blog/minimal-js-tracing/) - Jeremy Morrell, building OTLP-compatible tracer in ~200 lines
- [A Practitioner's Guide to Wide Events](https://jeremymorrell.dev/blog/a-practitioners-guide-to-wide-events/) - Jeremy Morrell, the definitive wide events guide with attribute taxonomy
- [All You Need Is Wide Events, Not Metrics](https://isburmistrov.substack.com/p/all-you-need-is-wide-events-not-metrics) - Isburmistrov, unification argument
- [Wide Events 101](https://boristane.com/blog/observability-wide-events-101/) - Boris Tane, practical intro
- [Is It Time to Version Observability?](https://charity.wtf/2024/08/07/is-it-time-to-version-observability-signs-point-to-yes/) - Charity Majors, O11y 1.0 vs 2.0

### Tools & Standards
- [OpenTelemetry Weaver](https://github.com/open-telemetry/weaver) - Schema validation and code generation for telemetry
- [OpenTelemetry JS SDK](https://github.com/open-telemetry/opentelemetry-js) - Reference implementation (we don't depend on it, but follow its data model)
- [OTel Semantic Conventions for Messaging](https://opentelemetry.io/docs/specs/semconv/messaging/) - Relevant for consumer/processor instrumentation

### emmett Internal References
- PRD: [prd.md](./prd.md)
- Workflow RFC: [src/rfc/001-Workflow.md](./src/rfc/001-Workflow.md)
- Current tracer: [src/packages/emmett/src/observability/tracer.ts](./src/packages/emmett/src/observability/tracer.ts)
- Serialization pattern (to replicate): [src/packages/emmett/src/serialization/json/jsonSerializer.ts](./src/packages/emmett/src/serialization/json/jsonSerializer.ts)
- Command handling: [src/packages/emmett/src/commandHandling/handleCommand.ts](./src/packages/emmett/src/commandHandling/handleCommand.ts)
- Event store types: [src/packages/emmett/src/eventStore/eventStore.ts](./src/packages/emmett/src/eventStore/eventStore.ts)
- In-memory event store: [src/packages/emmett/src/eventStore/inMemoryEventStore.ts](./src/packages/emmett/src/eventStore/inMemoryEventStore.ts)
- Processors: [src/packages/emmett/src/processors/processors.ts](./src/packages/emmett/src/processors/processors.ts)
- Projections: [src/packages/emmett/src/projections/index.ts](./src/packages/emmett/src/projections/index.ts)

---

## Current State of the Tracer

The existing tracer in `src/packages/emmett/src/observability/tracer.ts` is a basic structured logger. It:

- Records events with name, timestamp, and arbitrary attributes
- Supports log levels (DISABLED, INFO, LOG, WARN, ERROR) controlled via `DUMBO_LOG_LEVEL` env var
- Formats output as RAW JSON (PRETTY is stubbed) via the plugged `JSONSerializer`
- Outputs to `console.*` methods
- Has no concept of spans, traces, context propagation, or wide events
- Is a flat function (`tracer()` with `.info()`, `.warn()`, etc. methods bolted on)

Exports are minimal: just `index.ts` re-exporting `tracer.ts`.

## Serialization Pluggability Pattern (to replicate)

The pattern emmett uses for serialization options is clean and composable:

1. **Core type**: `JSONSerializationOptions` wraps an optional `{ serializer?, options? }` object
2. **Intersection spread**: Consumer option types include it via `& JSONSerializationOptions`
3. **Factory default**: `JSONSerializer.from(options?)` creates a serializer from options or returns a default
4. **Pass-through**: Options flow from top-level (command handler, event store) down to lower layers
5. **Non-invasive**: Everything is optional with sensible defaults; consumers ignore it unless they need customization

The observability system should follow this same pattern: define an `ObservabilityOptions` type that gets intersected into existing option types (`CommandHandlerOptions`, `EventStoreOptions`, etc.) and flows downward.

---

## Article: "Minimal JS Tracing" (Jeremy Morrell)

### The Central Thesis

Morrell argues that OpenTelemetry tracing looks intimidating but is fundamentally just two things combined: **structured logging** and **context propagation**. He demonstrates this by building a fully functional, OTLP-compatible tracer in ~200 lines of JavaScript that can export to Honeycomb, Baselime, or any OTLP backend.

The article's most important quote comes from OpenTelemetry co-founder Ted Young: **"The true spec is the data."** Meaning: if your implementation emits valid OTLP data and follows semantic conventions, it participates in the ecosystem regardless of whether it strictly follows the SDK specification. This is directly relevant to emmett -- we don't need to implement the full OTel SDK, just emit the right data.

### The Span Data Model

A span is a structured record describing a unit of work. The minimal required fields:

```typescript
{
  name: string,           // what work was done ("handleCommand", "appendToStream")
  startTime: number,      // unix timestamp in milliseconds
  durationMs: number,     // how long it took
  traceID: string,        // 16-byte hex, shared across all spans in the same trace
  spanID: string,         // 8-byte hex, unique to this span
  parentSpanID?: string,  // 8-byte hex, links to parent (undefined for root spans)
  attributes: Map<string, any>  // arbitrary key-value pairs
}
```

The three IDs create a DAG (directed acyclic graph). All spans in one "request flow" share a traceID. Each span has its own spanID. The parentSpanID links a child span to its parent, forming the tree structure that visualization tools render as waterfall charts.

For emmett, a trace would look like:

```
Trace: abc123
├── Span: "handleCommand(PlaceOrder)"     [parentSpanID: none]
│   ├── Span: "eventStore.readStream"     [parentSpanID: handleCommand's spanID]
│   └── Span: "eventStore.appendToStream" [parentSpanID: handleCommand's spanID]
```

### Context Propagation via AsyncLocalStorage

The key engineering challenge is: how does a child function know what its parent span is, without explicitly passing it as a parameter?

Morrell uses Node.js `AsyncLocalStorage` from `node:async_hooks`. This is a built-in Node.js API that maintains a "store" value across async operations -- when you `await` something, the store follows the async context automatically.

```javascript
import { AsyncLocalStorage } from "node:async_hooks";

const asyncLocalStorage = new AsyncLocalStorage();
// Initialize with empty context
asyncLocalStorage.enterWith({ traceID: undefined, spanID: undefined });

async function startSpan(name, lambda) {
  // Get the CURRENT context (which contains the parent's traceID and spanID)
  const ctx = asyncLocalStorage.getStore();

  // Create a new span, inheriting traceID and using parent's spanID as parentSpanID
  const span = new Span(name, ctx, new Map());

  // Run the lambda in a NEW context where this span is the "current" span
  // Any child startSpan() calls inside lambda will see THIS span as parent
  await asyncLocalStorage.run(span.getContext(), lambda, span);

  span.end();
  exporter.export(span);
}
```

The critical insight: `asyncLocalStorage.run()` creates a new scope. Inside that scope, `asyncLocalStorage.getStore()` returns the new span's context. Outside that scope, the old context is restored. This is what makes the parent-child linking automatic -- you just call `startSpan()` and it figures out the parent from the current async context.

For emmett, this means the command handler can call `startSpan("handleCommand")`, and when it internally calls `eventStore.readStream()`, the event store can call `startSpan("readStream")` without receiving any context parameter -- `AsyncLocalStorage` threads the parent context through.

### Distributed Tracing with traceparent

For context propagation across service boundaries (HTTP calls), the W3C `traceparent` header carries the context:

```
Format: 00-{traceID}-{spanID}-01
Example: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

When making an outbound HTTP call, the current span's traceID and spanID are serialized into this header. The receiving service parses it and uses it as the parent context for its root span.

Morrell wraps `fetch` to do this automatically:

```javascript
function patchFetch(originalFetch) {
  return async function patchedFetch(resource, options = {}) {
    const ctx = getContext();
    options.headers = options.headers || {};
    options.headers["traceparent"] = `00-${ctx.traceID}-${ctx.spanID}-01`;

    let resp;
    await startSpan("fetch", async (span) => {
      span.setAttributes({ "http.url": resource });
      resp = await originalFetch(resource, options);
      span.setAttributes({ "http.response.status_code": resp.status });
    });
    return resp;
  };
}
```

### OTLP Export Format

OTLP (OpenTelemetry Protocol) defines how telemetry data is transmitted. The JSON format wraps spans in a nested structure:

```javascript
{
  resourceSpans: [{
    resource: {
      attributes: [
        { key: "service.name", value: { stringValue: "emmett" } },
        // ... global attributes
      ]
    },
    scopeSpans: [{
      scope: { name: "emmett-tracer", version: "0.1.0" },
      spans: [{
        traceId: "abc...",
        spanId: "def...",
        parentSpanId: "ghi...",
        name: "handleCommand",
        startTimeUnixNano: 1234567890000000,  // nanoseconds!
        endTimeUnixNano:   1234567940000000,
        kind: 2,  // SERVER=2, CLIENT=3, INTERNAL=1
        attributes: [
          { key: "command.type", value: { stringValue: "PlaceOrder" } }
        ]
      }]
    }]
  }]
}
```

Note: OTLP uses nanoseconds, not milliseconds. The attribute format is verbose (`{ key, value: { stringValue } }` or `{ intValue }`, `{ boolValue }`, etc.).

Export is a simple HTTP POST to an OTLP endpoint (e.g., `https://api.honeycomb.io/v1/traces` or `http://localhost:4318/v1/traces`).

### Why the Official OTel SDK Is Larger

Morrell's ~200-line version skips: batching/buffering of exports, browser compatibility, robust error handling, auto-instrumentation of libraries, performance optimization for tight loops, and full semantic convention compliance. These are real production concerns but not required for a minimal viable tracer.

### Relevance to emmett

The article proves that a minimal, OTLP-compatible tracer is feasible without depending on the `@opentelemetry/*` packages. The key components to implement:
1. A Span class/type with the fields above
2. An `AsyncLocalStorage`-based context store
3. A `startSpan(name, fn)` function that handles context threading
4. An exporter interface (console, OTLP HTTP, noop)
5. Span attributes following OTel semantic conventions where applicable

---

## Article: "A Practitioner's Guide to Wide Events" (Jeremy Morrell)

### The Central Thesis

Wide events unify metrics, logs, and traces into a single pattern: **for each unit-of-work, emit one event with all the information you can collect about that work.** The "unit of work" is usually an HTTP request/response cycle, but it applies to any bounded operation -- like handling a command or appending to an event store.

This isn't new theory. Stripe called them "Canonical Log Lines" in 2019 (based on Brandur Leach's 2016 concept). AWS recommends the pattern for distributed systems. What's new is the tooling (columnar databases, OpenTelemetry) making it practical.

### The "Main Span" Pattern

This is the most architecturally important pattern in the article. In a typical request, you may create multiple child spans (database queries, HTTP calls, etc.). But the wide events philosophy says: **keep a reference to the root/main span and keep annotating it throughout the request lifecycle.**

```javascript
const MAIN_SPAN_KEY = createContextKey("main_span");

function middleware(req, res, next) {
  const span = trace.getActiveSpan();
  span.setAttribute("main", true);
  // Store a reference to this span in context so it's accessible even
  // when child spans become the "active" span
  context.with(ctx.setValue(MAIN_SPAN_KEY, span), () => next());
}

// Helper to annotate the main span from anywhere in the request
function setMainAttrs(attrs) {
  const mainSpan = context.active().getValue(MAIN_SPAN_KEY);
  mainSpan?.setAttributes(attrs);
}
```

For emmett, the equivalent would be: the command handler creates the "main span" for the command. As the event store reads the stream, decides on events, and appends them, those subsystems annotate the main span with their attributes (in addition to potentially creating their own child spans for timing).

### Attribute Density: What to Put on a Wide Event

The article provides an exhaustive taxonomy. The philosophy is: **default to inclusion.** Storage cost per attribute is negligible in columnar systems. Here's what matters for emmett specifically:

**Service/operation metadata:**
- `service.name`, `service.version`, `service.environment`
- `command.type` (e.g., "PlaceOrder")
- `stream.name`, `stream.category`
- `event.types` (array of event type names produced)
- `event.count` (number of events appended)

**Performance timings as attributes (not child spans):**
Instead of creating a child span for every small operation, record durations as attributes on the main span:
- `eventStore.read.duration_ms` -- how long did the stream read take?
- `eventStore.append.duration_ms` -- how long did the append take?
- `decider.decide.duration_ms` -- how long did the business logic take?

This is simpler than a full span tree and gives you the same debugging power for most questions ("why was this command slow? oh, the read took 800ms").

**Async work summaries:**
Aggregate counts and durations for repeated operations:
- `stats.events_read_count` -- how many events were read from the stream?
- `stats.events_appended_count` -- how many new events were appended?

**Error context:**
- `error` (boolean flag -- crucial for filtering)
- `exception.message`, `exception.type`, `exception.stacktrace`
- `exception.expected` (true/false -- distinguish business rule rejections from unexpected failures)

**User/customer context (if available at the command handling layer):**
- `user.id`, `user.type`
- Feature flags if applicable

**Sampling metadata:**
- `sample_rate` -- include this so backends can weight calculations

### Timing Breakdown Without Child Spans

A key practical recommendation: **use attributes for timing breakdown rather than creating child spans for everything.** Child spans are for when you need to see the full timeline/waterfall (e.g., in distributed tracing across services). But for within-a-service timing, attributes are faster to create, easier to query, and produce less telemetry volume.

```
// Instead of this (child spans):
handleCommand [100ms]
  ├── readStream [30ms]
  ├── decide [10ms]
  └── appendToStream [60ms]

// Do this (attributes on main span):
handleCommand [100ms]
  attributes:
    eventStore.read.duration_ms: 30
    decider.decide.duration_ms: 10
    eventStore.append.duration_ms: 60
```

Both give you the answer to "why was this slow?" but the attribute approach is cheaper and simpler. You can always add child spans *as well* for operations where you need the full timeline.

### Storage and Cost

Wide events compress well in columnar formats because:
- **Constant-value columns** (service.name is the same for all events from one service) store one value per row group
- **Dictionary encoding** (event.type has a small set of distinct values) uses bit-packed lookups
- **Type-aware compression** handles numbers, strings, booleans differently

At 1000 req/s with 1% sampling: ~1M events/day. In DuckDB format: ~80MB. In R2/S3 storage: ~$0.07/month for 60 days. This is relevant to emmett's goal of allowing DuckDB/ClickHouse as export targets.

### What Wide Events Are NOT

- They do NOT replace infrastructure metrics (CPU, memory monitoring)
- They are NOT just structured logs -- structured logs might have 5-10 fields, wide events have hundreds
- They require a columnar OLAP backend for efficient querying (not Elasticsearch, not a regular log store)
- You can emit more than one per request if needed (one per service hop is the common case)

---

## Article: "All You Need Is Wide Events, Not Metrics" (Isburmistrov)

### The Unification Argument

The core argument is that the three pillars of observability (metrics, logs, traces) are artificial distinctions. They're all special cases of the same thing:

- **A trace/span** is a wide event that happens to have `SpanId`, `TraceId`, and `ParentSpanId` fields
- **A log** is a wide event that happens to have a `message` field
- **A metric** is a wide event that happens to contain counter/gauge values captured at an interval

If you store all your telemetry as wide events, you can derive metrics from them (by aggregating), reconstruct traces from them (by following span IDs), and search them like logs (by filtering on message or any other field).

### Cardinality Freedom

The article's strongest practical argument: traditional metrics systems (Prometheus, DataDog metrics, CloudWatch) break down with high-cardinality dimensions. If you want to track latency per user_id, and you have 1M users, you'd create 1M time series -- which is either prohibitively expensive or technically impossible.

Wide events have no cardinality problem because you're storing raw events, not pre-aggregated time series. You can group by user_id at query time because you're scanning raw events, not maintaining time series indices.

This matters for emmett because event-sourced systems naturally have high-cardinality data: stream names, event types, command types, aggregate IDs. You want to be able to answer "what's the p99 latency for commands on stream 'order-12345'?" without pre-defining that metric.

### The "Slice and Dice" Paradigm

The article references Meta's Scuba system as the gold standard. The investigation flow:

1. Notice an anomaly in an aggregate view
2. Group by different dimensions to narrow the cause (is it one user? one endpoint? one region?)
3. Filter progressively until you find the specific case
4. Examine individual events for root cause

This is fundamentally different from the "write a query against separate metrics/logs/traces systems" approach. The power comes from having all the dimensions on a single event that you can slice across.

### Sampling as a First-Class Concept

The article emphasizes that sampling must be built into the data model, not bolted on. Each event should carry a `samplingRate` field (N, meaning "this event represents N events"). Aggregation queries multiply by the sample rate to get accurate totals. Dynamic sampling (sample more during quiet periods, less during peaks) keeps costs predictable.

---

## Article: "Wide Events 101" (Boris Tane)

### The Three Properties

For an event to qualify as "wide," it needs:

1. **High cardinality**: Fields with many distinct values (user IDs, request IDs, stream names). This is what makes group-by queries powerful.
2. **High dimensionality**: Many fields per event. Not 5-10 like a typical log line, but 50-200+.
3. **Context richness**: Business logic data alongside infrastructure data. Not just "request took 100ms" but "PlaceOrder command for user-123 on stream order-456 produced 2 events in 100ms with stream version 7."

### The "Unknown Unknowns" Argument

Traditional monitoring is good at catching known failure modes (error rate spikes, latency thresholds). But the hardest bugs are the ones you didn't anticipate. Wide events let you explore after the fact -- "hmm, this is only happening for users on version 2.3 of the mobile app, on Android 14, when they have more than 100 items in their cart." You couldn't have pre-defined that metric, but if all those dimensions are on the event, you can discover it through exploration.

### Implementation Pattern

Tane shows a straightforward implementation: create an object at the start of the request, progressively add fields throughout processing, emit it at the end.

```javascript
app.post('/articles', async (c) => {
  const wideEvent = {
    method: 'POST',
    path: '/articles',
    requestId: c.get("requestId"),
  };

  try {
    // Business logic happens, adding context along the way
    wideEvent["article.id"] = savedArticle.id;
    wideEvent["article.wordCount"] = savedArticle.wordCount;
    wideEvent["status_code"] = 201;
    wideEvent["outcome"] = "ok";
  } catch (error) {
    wideEvent["outcome"] = "error";
    wideEvent["exception.message"] = error.message;
  } finally {
    // One event emitted at the end with everything
    logger.info(JSON.stringify(wideEvent));
  }
});
```

### Relationship to OpenTelemetry

Tane explicitly connects wide events to OTel: "Within [OpenTelemetry], wide events become 'spans,' and request correlations become 'traces.'" OTel adds value by automating context propagation (the traceparent header, AsyncLocalStorage) and providing standard attribute naming (semantic conventions). But the core concept -- one rich event per operation -- predates OTel and doesn't require it.

---

## Article: "Is It Time to Version Observability?" (Charity Majors)

### Observability 1.0

The current mainstream approach. Defined by:

- **Three separate systems**: Metrics (time series databases), logs (text/structured log stores), traces (distributed tracing backends)
- **Write-time aggregation**: You decide up front which dimensions matter and pre-compute aggregates. This means you can only answer questions you anticipated.
- **Cardinality as the enemy**: Every new dimension in metrics multiplies storage and query cost. Teams spend significant effort managing cardinality (which tags to keep, which to drop).
- **Static dashboards**: You build dashboards for known failure modes and stare at them during incidents, hoping the right chart exists.
- **Cost explosion**: Data gets stored 3x (once per pillar), costs scale with traffic, and the analytical value often decreases as volume grows because the most interesting dimensions get dropped to save money.

### Observability 2.0

The emerging approach, which the wide events articles describe:

- **Single data format**: Arbitrarily-wide structured events with trace/span IDs attached. One source of truth.
- **Read-time aggregation**: Store raw events, compute aggregates at query time. This means you can answer any question after the fact, including questions you didn't anticipate.
- **Cardinality freedom**: Since you're storing raw events (not pre-computed time series), any field can have unlimited distinct values without performance or cost implications.
- **Exploratory analysis**: Instead of staring at dashboards, you "slice and dice" -- start from an anomaly, group by different dimensions to narrow the cause, drill down to individual events.
- **Dynamic sampling**: Control costs by sampling at write time, with the sample_rate field preserving statistical validity.

### The Key Insight for emmett

Majors argues that the shift isn't just about tooling -- it changes the development workflow:

> "Your job as a developer isn't done until you know it's working in production. Deploying to production is the beginning of gaining confidence in your code, not the denouement."

For emmett, this means the observability system should be designed for developers to use during development and after deployment, not just for ops teams during incidents. The command handler should tell you "here's exactly what happened when PlaceOrder ran: it read 5 events from stream order-123, took 30ms to decide, produced 2 new events, and the append took 15ms, stream version went from 5 to 7." This is the kind of wide event that makes event sourcing debuggable.

### Five-Year Prediction

Majors predicts that within five years, "all modern engineering teams [will be] powering their telemetry off of tools backed by wide, structured log events, not metrics." The tools are already here (Honeycomb, ClickHouse, DuckDB); the adoption is catching up.

---

## OpenTelemetry Weaver

A Rust-based toolkit from the OpenTelemetry project for managing observability schemas. It treats telemetry signals as first-class APIs:

- **Schema validation**: Validates that your instrumentation follows naming conventions and type rules
- **Code generation**: Generates typed code from schema definitions (e.g., "here are the attributes a `handleCommand` span must have")
- **Live-checking**: Validates actual OTLP streams against schemas at runtime
- **Registry management**: Manages a registry of semantic conventions with versioning and diff detection

Relevant for emmett's future: if we define a schema for our command handling and event store spans (attribute names, types, required vs optional), Weaver could generate TypeScript types and validate that our instrumentation is correct. Not needed for the initial implementation, but the architecture should be "schema-friendly" -- meaning attribute names should follow consistent conventions that a schema could describe.

---

## Critical Analysis & Assessment

### The PRD Direction Is Sound, But Has Tensions Worth Surfacing

The PRD sets up a genuinely good goal: observability that's opinionated enough to be useful out of the box, but pluggable enough to avoid vendor lock-in. The wide events + OTLP approach that the articles converge on is the right foundation for this. But there are a few tensions in the PRD that need resolving.

### Tension 1: "Not Require OpenTelemetry" vs. OTLP Compatibility

The PRD says to "add observability based on the Open Telemetry standard, but not require to use it as it may bring some performance issues." This is a nuanced position, and Morrell's article provides the exact resolution: **you don't need the OpenTelemetry SDK, you just need to emit OTLP-compatible data.**

The OTel JS SDK (`@opentelemetry/sdk-trace-node`, `@opentelemetry/api`, etc.) is heavy. It pulls in dozens of packages, has complex initialization, and for hot paths the overhead of the full context propagation machinery, sampler chain, span processor pipeline, etc. can matter. The PRD is right to be wary.

But "OTLP-compatible" and "depending on the OTel SDK" are different things. Morrell proved that in 200 lines. The span data model (traceId, spanId, parentSpanId, attributes, timestamps) is trivial to implement. `AsyncLocalStorage` is a built-in Node.js API -- no OTel dependency needed. The OTLP JSON wire format is verbose but mechanical to produce.

**My assessment**: emmett should implement its own lightweight span model and context propagation (following Morrell's pattern), and provide an OTLP exporter that transforms spans into the OTLP wire format. No `@opentelemetry/*` dependency. Users who want full OTel integration can write a custom exporter or use a bridge -- but that's their choice, not a requirement.

One caveat: the OTel JS SDK uses `AsyncLocalStorage` internally too (via `AsyncLocalStorageContextManager`). If a user already has OTel set up in their app, there could be context conflicts with two independent `AsyncLocalStorage` instances. We should think about whether to support "plug into an existing OTel context" as an option. Not a day-one concern, but worth noting in the design.

### Tension 2: Wide Events vs. Span Trees -- Which Is Primary?

The articles present two related but distinct models, and it's worth being clear about where they agree and disagree.

**The span tree model** (Morrell's "Minimal JS Tracing") emphasizes hierarchy: parent-child relationships between operations, waterfall visualizations, distributed trace assembly. This is what Jaeger, Zipkin, and the OTel trace visualization tools show you. It's powerful for understanding "what called what" across services.

**The wide events model** (Morrell's second article, Isburmistrov, Tane, Majors) emphasizes richness on a single event: pack hundreds of attributes onto one span per unit of work. Use attributes for timing breakdowns instead of child spans. Optimize for "slice and dice" querying, not for waterfall visualization.

These two models are compatible but represent different priorities:

- **Span trees** optimize for: distributed trace assembly, cross-service waterfall visualization, understanding call chains
- **Wide events** optimize for: exploratory debugging, aggregate analysis, finding unknown unknowns through dimensional slicing

For emmett, **wide events should be the primary model**. Here's why:

1. Event sourcing command handling is typically *within* a single service. The command handler calls the event store, which is usually in-process. You don't need a span tree to understand that `handleCommand` called `readStream` and then `appendToStream` -- that's always the sequence. What you need is: how long did each part take, what events were produced, what was the stream version, did the optimistic concurrency check fail?

2. The real debugging questions in event sourcing are dimensional: "which command types are slowest?", "which streams have the most events?", "are PlaceOrder commands failing more since the last deploy?", "what's the average number of events per append for OrderAggregate?" These are wide event / slice-and-dice questions.

3. Span trees become valuable when emmett operates in a *distributed* context -- e.g., a command handling HTTP endpoint that reads from one event store and projects to another. That's a day-two concern.

**My assessment**: the core abstraction should produce wide events (richly-attributed spans). Span hierarchy (traceId/spanId/parentSpanId + AsyncLocalStorage) should be included because it's cheap (~40 lines of code), it's required for OTLP compatibility, and it enables distributed tracing when needed. But the *instrumentation guidance* and *default behavior* should emphasize putting attributes on the main span (the "command handling" span), not creating deep span trees.

Concretely: `handleCommand` creates a span. The event store operations annotate that span with `eventStore.read.duration_ms`, `eventStore.append.duration_ms`, `stream.name`, `event.types`, etc. The event store *also* creates its own child spans (so you can drill into the tree if needed), but the main span is where the wide event attributes live. This gives you both models without forcing a choice.

### Tension 3: Simplicity vs. Pluggability

The PRD wants both a "simple as possible" tracer and one that's "pluggable with modern tooling like Weaver." These can coexist, but only if the layers are separated clearly.

**Layer 1: The data model** -- Span type with fields, attribute types, span event types. This should be simple, concrete types. No interfaces, no generics, no abstraction. Just data.

**Layer 2: The context propagation** -- `AsyncLocalStorage`-based context store, `startSpan(name, fn)` function. One implementation, not pluggable. `AsyncLocalStorage` is the right answer for Node.js and there's no reason to abstract over it.

**Layer 3: The exporter** -- This is where pluggability lives. An exporter receives completed spans and does something with them (console print, OTLP HTTP POST, write to DuckDB, noop). The interface should be `{ export(spans: ReadonlyArray<Span>): Promise<void> }`. Multiple exporters can be composed (send to console AND OTLP).

**Layer 4: The configuration** -- Following the serialization options pattern: an `ObservabilityOptions` type that flows through the option types. Contains the exporter(s), sampling config, and global attributes (service.name, etc.).

Weaver fits at Layer 1 (schema for the data model) and could be a future concern. The architecture doesn't need to do anything special for it -- if attribute names follow consistent dot-notation conventions (`command.type`, `eventStore.read.duration_ms`), Weaver can validate them.

### On Domain Events as Span Content

The PRD asks: "Events could be possibly stored as span events (or other way)."

The OTel spec defines two distinct concepts:
- **Span attributes**: Key-value pairs set on a span. These are the "wide" part of wide events. Good for dimensions you want to filter/group by.
- **Span events**: Timestamped annotations *within* a span. Think of them as "something happened at this moment during the span's lifetime." They have a name, a timestamp, and their own attributes.

Domain events from event sourcing fit **both** models, but with different trade-offs:

**As span attributes** (recommended default):
```
command.event_types: ["OrderPlaced", "InventoryReserved"]
command.event_count: 2
stream.version.before: 5
stream.version.after: 7
```
Pros: Simple, queryable (you can GROUP BY `command.event_types`), follows the wide events philosophy of denormalizing onto the main span.
Cons: Loses individual event timestamps and per-event attributes.

**As OTel span events**:
```
span.addEvent("OrderPlaced", { "event.version": 6, "order.id": "123" })
span.addEvent("InventoryReserved", { "event.version": 7, "order.id": "123", "warehouse": "west" })
```
Pros: Preserves per-event detail and timestamps. Matches the OTel mental model ("something happened during this span"). Richer data.
Cons: Most observability backends (Honeycomb, Jaeger) render span events poorly -- they're often collapsed or hidden. Harder to query. More verbose.

**My assessment**: Default to attributes. The wide events consensus is clear: put everything queryable on the main span as attributes. But the architecture should make it trivial to also add span events for users who want the detail. The command handling instrumentation should record `command.event_types` and `command.event_count` as attributes, and optionally (via configuration) also call `span.addEvent()` for each domain event.

The OTel semantic conventions for messaging (which I checked via context7) reinforce this. They use `messaging.batch.message_count` as a span attribute for batch operations, not individual span events per message. Our `command.event_count` follows the same pattern.

### On the "Pluggable Like Serialization" Pattern

The serialization pattern in emmett is clean: `JSONSerializationOptions` intersected into consumer types, with a factory default. Replicating this for observability makes sense, but with one important difference.

Serialization is a **per-operation** concern -- you might want different serialization for different event store reads. Observability is more of a **per-system** concern -- you typically configure it once at startup and it applies everywhere.

That said, the ability to override at lower levels has value. You might want different sampling rates for different command types, or extra attributes on event store operations. So the pattern should be: **configure globally, allow per-operation overrides.**

```typescript
// Global config
const store = getInMemoryEventStore({
  observability: {
    tracer: myTracer,
    exporter: [consoleExporter(), otlpExporter({ endpoint: "..." })],
    globalAttributes: { "service.name": "order-service" },
  }
});

// Per-operation override (optional)
await handleCommand(store, id, command, {
  observability: {
    additionalAttributes: { "tenant.id": tenantId },
  }
});
```

### On "Build a Dashboard Like .NET Aspire"

The PRD mentions eventually building a dashboard. This is the right long-term vision but I want to flag: .NET Aspire's dashboard works because it consumes OTLP and has a built-in OTLP receiver. If emmett emits OTLP-compatible data, a dashboard is "just" an OTLP consumer -- it could be a standalone service that receives OTLP over HTTP and renders it.

This reinforces the importance of getting the OTLP export format right from day one. The dashboard becomes a specialized exporter/receiver, not a separate concern.

### On Performance Concerns

The PRD rightly flags potential performance issues. Here's what the research tells us:

1. **AsyncLocalStorage overhead**: Measured by the Node.js team at ~8% overhead for context propagation in microbenchmarks. In real applications with I/O, this is negligible. The OTel JS SDK team considers it production-safe.

2. **Span creation overhead**: Creating a span (generating IDs, recording start time, storing attributes) is microseconds. The expensive part is export -- serializing to JSON, making HTTP calls. This is why exporters should batch and run async.

3. **The noop exporter is key**: When observability is disabled (no exporter configured, or noop exporter), the cost should be near-zero. The `startSpan` function should check for the noop case early and skip as much work as possible. This is how the OTel SDK works -- if no tracer provider is registered, all operations are no-ops.

4. **Sampling reduces export cost**: With 1% sampling, you emit 1% of spans. The span creation still happens (to make the sampling decision), but the expensive export step is skipped for 99% of spans.

### Summary of Recommendations

1. **Implement a lightweight span model** with traceId/spanId/parentSpanId, following Morrell's pattern. No OTel SDK dependency.
2. **Use AsyncLocalStorage** for context propagation. No abstraction over it -- it's the right tool.
3. **Default to wide events**: Put everything on the main span as attributes. Support span events as an opt-in.
4. **Exporter interface**: `{ export(spans: ReadonlyArray<Span>): Promise<void> }`. Ship with noop, console, and OTLP HTTP.
5. **Follow the serialization options pattern** for configuration, but with global-first semantics.
6. **Domain events as attributes by default**, with opt-in span events for detail.
7. **OTLP-compatible internal data model** from day one. Conversion to wire format happens in the exporter.
8. **Performance**: noop exporter should short-circuit early. Batched async export for real exporters.

---

### Analysis of the past sample/ Java Inspiration Code

The Java code in `past sample/` represents a well-structured **Observability 1.0** implementation -- separate metrics (counters, distributions, histograms) with tagged dimensions, routed to DataDog or kept in-memory for testing.

#### Architecture Walkthrough

The architecture has four layers:

**1. Metrics primitives** (`Metrics.java`): Defines interfaces for Counter, Distribution, Histogram, Gauge, Timer, ServiceCheck. These are generic metric types, not tied to any backend. `Counter.increment(tags)` and `Distribution.record(durationInMs, tags)` are the two most-used operations.

**2. MetricsFactory** (`MetricsFactory.java`): Factory interface to create metric instances. Implementations: `DataDogMetricsFactory` (backed by StatsD client), `InMemoryMetricsFactory` (noop for testing). This is the pluggability layer -- swap the factory, swap the backend.

**3. EventStoreMetricsCollector** (`EventStoreMetricsCollector.java`): The domain-specific metrics definition. This is where the actual instrumentation decisions live. It defines *what* to measure for event store operations:

| Metric | Type | Tags | Purpose |
|---|---|---|---|
| `matching.stream.appending.duration` | Distribution | aggregate-type, status | How long appends take, broken down by stream type and success/failure |
| `matching.stream.appending.size` | Distribution | aggregate-type | How many events per append batch |
| `matching.event.appending.count` | Counter | aggregate-type, event-type | Count of individual events appended, per type |
| `matching.stream.reading.duration` | Distribution | aggregate-type, status | How long reads take |
| `matching.stream.reading.size` | Distribution | aggregate-type | How many events per read |
| `matching.event.reading.count` | Counter | aggregate-type, event-type | Count of individual events read, per type |
| `matching.command.handling.duration` | Distribution | (defined but not shown being used) | Command handling time |
| `matching.command.handling.latency` | Distribution | (defined but not shown being used) | Command handling latency |
| `matching.command.validation.error.count` | Counter | (defined but not shown being used) | Validation error count |

The tag dimensions chosen are revealing: **aggregate-type** (stream category), **event-type**, **status** (success/failure), **command-type**, **command-origin**, **command-processing-model**. These are exactly the high-cardinality dimensions that matter for event sourcing.

**4. MetricsEventStoreWrapper** (`MetricsEventStoreWrapper.java`): A decorator that wraps the real EventStore, intercepting each method call to measure it. Uses `MetricsTimer.measure()` to capture duration and error state, then forwards results to the collector.

#### What This Architecture Gets Right

1. **The dimensions are spot-on.** Stream type, event type, operation status, command type -- these are the axes you want to slice by when debugging an event-sourced system. The new wide events approach should carry all of these forward as span attributes.

2. **The wrapper/decorator pattern** keeps instrumentation separate from business logic. The EventStore doesn't know about metrics. This is clean separation of concerns.

3. **The factory abstraction** (`MetricsFactory`) makes backend swappable. DataDog and InMemory share the same interface. This maps directly to the exporter concept in the new system.

4. **`MetricsTimer.measure()`** is a clean utility: run a function, capture duration and error state, return the result. Both void and result-returning variants. This pattern maps to `startSpan()` in the new system.

#### What the Wide Events Approach Improves

This is where the articles' O11y 2.0 critique applies concretely:

1. **Pre-defined metrics can't answer unanticipated questions.** The collector defines specific metrics (append duration, read size, etc.). If you later want to correlate "append duration by stream type AND event count AND whether it was a retry" -- you can't, because that combination wasn't pre-defined. With wide events, all dimensions are on the same event, so any combination of GROUP BY and WHERE is possible.

2. **Separate counters and distributions lose context.** The counter `event.appending.count` and the distribution `stream.appending.duration` are separate metrics. You can't directly ask "what was the average duration of appends that produced OrderPlaced events?" because the duration and event type live in different metric streams. With wide events, both are attributes on the same span: `command.event_types: ["OrderPlaced"]` and `eventStore.append.duration_ms: 45`.

3. **The wrapper pattern adds coupling.** The `MetricsEventStoreWrapper` must implement every `EventStore` method and manually forward them. If `EventStore` gains a new method, the wrapper breaks. In the TypeScript/wide events approach, instrumentation can be built into the `handleCommand` flow through options, not through a separate wrapper class.

4. **Tags vs. attributes.** The Java code uses `String[]` for tags with a `"key:value"` format (DataDog convention). This is stringly-typed and easy to misformat. The span attributes model uses `Record<string, AttributeValue>` which is more structured and type-safe.

#### What to Carry Forward

The *metrics definitions themselves* are the most valuable asset from this code. They tell us exactly which dimensions matter for event store operations. Translated to span attributes:

```typescript
// Command handling span attributes
"command.type": "PlaceOrder"
"command.origin": "http"          // (from COMMAND_ORIGIN_TAG)
"command.processing_model": "..."  // (from COMMAND_PROCESSING_MODEL_TAG)
"command.duration_ms": 100
"command.status": "success" | "failure"
"command.validation_error": true | false

// Event store read attributes (on the command span or child span)
"eventStore.read.duration_ms": 30
"eventStore.read.stream_type": "BankAccount"
"eventStore.read.event_count": 5
"eventStore.read.event_types": ["BankAccountOpened", "DepositRecorded", ...]
"eventStore.read.status": "success" | "failure"

// Event store append attributes
"eventStore.append.duration_ms": 15
"eventStore.append.stream_type": "BankAccount"
"eventStore.append.event_count": 2
"eventStore.append.event_types": ["DepositRecorded", "CashWithdrawnFromAtm"]
"eventStore.append.batch_size": 2
"eventStore.append.status": "success" | "failure"

// Stream context
"stream.name": "BankAccount-123"
"stream.type": "BankAccount"       // (= AGGREGATE_TYPE_TAG)
"stream.version.before": 5
"stream.version.after": 7
```

The `MetricsTimer.measure()` pattern translates to: wrap the operation in a span, record the duration, capture the result (or error), and set attributes based on both.

---

## Consumers, Processors & Workflows: Observability Implications

The consumer/processor architecture and the workflow RFC change the observability picture substantially. The write side (command handling + event store) is the simple case. The processing side is where the real complexity lives.

### The Trace Propagation Problem

On the write side, everything happens in a single synchronous flow:

```
HTTP Request → handleCommand → eventStore.readStream → decide → eventStore.appendToStream
```

One trace, one parent-child chain, one `AsyncLocalStorage` context. Simple.

On the processing side, the flow is fundamentally async and decoupled:

```
1. Command handler produces events in Trace A (synchronous)
2. Consumer polls events from the event store (sometime later)
3. Consumer fans out to multiple processors
4. Each processor handles events independently
5. Processor may trigger workflows that span hours/days
```

**Trace A is long finished by the time processors run.** Making processors children of Trace A would create traces that span hours or days -- breaking tail sampling, creating enormous traces, and misrepresenting the actual execution model.

This is precisely why Oskar specified **links over trace propagation** for async flows.

### How Links Work

In OTel, a span link says "this span is related to that other span/trace" without implying a parent-child relationship. The data model is:

```typescript
{
  traceId: string,    // the related trace
  spanId: string,     // the related span within that trace
  attributes?: Record<string, AttributeValue>  // context about the relationship
}
```

For emmett's processing side:

- The **command handler span** records `traceId` and `spanId` as metadata on the events it produces (stored alongside the event in the event store)
- When a **processor** handles those events, it creates its own fresh trace, but adds a **link** back to the originating command handler span
- Querying tools can then navigate: "show me the command that produced this event" and "show me all processors that handled events from this command"

This requires storing trace context as event metadata. The event store already stores metadata per event -- the trace context (traceId, spanId) should be part of that metadata.

### Consumer Observability

Consumers are "dumb routers" by design, but they're the critical infrastructure. Observability should surface:

**Per-poll-cycle span attributes:**
- `consumer.source`: which event store / stream is being polled
- `consumer.batch_size`: how many events were fetched this cycle
- `consumer.processor_count`: how many processors are registered
- `consumer.poll_duration_ms`: how long the poll itself took
- `consumer.earliest_checkpoint`: the lowest checkpoint across all processors (determines where polling starts)
- `consumer.lag`: gap between latest event position and earliest checkpoint

**Per-delivery attributes (on child spans or as events):**
- `consumer.delivery.processor_id`: which processor received the batch
- `consumer.delivery.duration_ms`: how long the delivery took
- `consumer.delivery.status`: success/failure

The consumer span should be a fresh trace each poll cycle (not linked to any specific command trace, since it polls events from many commands).

### Processor Observability

Processors are "where the interesting work happens." Each processor creates its own span per batch or per message, depending on the archetype:

**Projector span attributes:**
- `processor.id`: the processor identifier
- `processor.type`: "projector" | "reactor" | "workflow" | "custom"
- `processor.batch_size`: how many events in this batch
- `processor.checkpoint.before`: checkpoint position before processing
- `processor.checkpoint.after`: checkpoint position after processing
- `processor.event_types`: which event types were in this batch
- `processor.duration_ms`: total processing time
- `processor.status`: "ack" | "skip" | "stop" | "error"
- Links to originating command traces (one link per unique source trace in the batch)

**Reactor span attributes** (same as projector, plus):
- `reactor.side_effect`: what action was triggered
- `reactor.side_effect.duration_ms`: how long the side effect took

### Workflow Observability: The Hardest Case

Workflows are event-sourced processes that span hours or days. The workflow stream interleaves inputs and outputs from many different original traces. A single workflow instance (e.g., GroupCheckout-123) might process events from dozens of different command traces over its lifetime.

The RFC says: "No distributed tracing needed" because "everything about a workflow lives in one stream." But that's the *durability* story. For *operational observability*, you still want to know:

1. How long is the workflow taking end-to-end?
2. Which step is it stuck on?
3. Which input caused a failure?
4. How do you connect a workflow step back to the original command that triggered it?

**Workflow span model:**

Each message processing in a workflow creates a span:
- `workflow.id`: the workflow instance ID (GroupCheckout-123)
- `workflow.type`: "GroupCheckoutWorkflow"
- `workflow.step`: "decide" (what function was called)
- `workflow.input.type`: "GuestCheckedOut" (what message triggered this step)
- `workflow.state.status`: "Pending" → "Finished" (state transition if any)
- `workflow.outputs`: ["GroupCheckoutCompleted"] (what was produced)
- `workflow.outputs.count`: 1
- `workflow.stream_position`: 9 (position in the workflow stream)
- Links to: the originating trace that produced the input event

The workflow *itself* doesn't need one giant trace spanning its lifetime. Instead, each step is its own span/trace, linked to the previous steps via the workflow stream. The workflow stream *is* the trace -- it just lives in the event store rather than in an observability backend. The observability spans add operational metrics (timing, errors) on top of what the stream already provides.

### The "Double Hop" and Observability

The workflow RFC describes a double-hop: Input → store in workflow stream → consume from workflow stream → process → store outputs.

Each hop should be observable:
1. **Input routing** (Router function determines workflow instance): span with `workflow.router.duration_ms`, `workflow.id` determined
2. **Input storage** (Store input in workflow stream): part of the event store append span
3. **Processing** (Rebuild state + decide): span with `workflow.decide.duration_ms`, `workflow.evolve.duration_ms`, `workflow.state_rebuild.event_count`
4. **Output storage** (Store outputs): part of the event store append span
5. **Output processing** (Send commands, publish events): span with links to the workflow span

### Impact on the Data Model

This means the span type needs to support **links** from day one:

```typescript
type SpanLink = {
  traceId: string;
  spanId: string;
  attributes?: Record<string, AttributeValue>;
};

type Span = {
  // ... existing fields ...
  links?: SpanLink[];
};
```

And the event store needs to store trace context as event metadata:

```typescript
type EventMetadata = {
  // ... existing metadata ...
  traceId?: string;
  spanId?: string;
};
```

This enables the link chain: command handler → event metadata → processor reads metadata → processor creates link.

### Backpressure Observability

The article mentions backpressure as a future concern but one worth designing for. Observability is how you detect backpressure before it becomes a crisis:

- `processor.processing_rate`: events/second this processor handles
- `consumer.delivery_rate`: events/second being delivered
- `processor.lag_events`: how far behind this processor is
- `processor.lag_duration_ms`: estimated time to catch up

These could be derived from span data (not separate metrics), following the wide events philosophy.

---

## Metrics Catalog

What we want to capture, organized by component. Each row is a span attribute on the relevant span. Together these form the "wide event" for each unit of work.

### Command Handling Metrics

| Attribute | Type | Source | Purpose |
|---|---|---|---|
| `command.type` | string | command metadata | Which command was handled (PlaceOrder, CheckOut) |
| `command.status` | string | result | "success" or "failure" |
| `command.duration_ms` | number | timing | Total time for the handleCommand call |
| `command.validation_error` | boolean | result | Did validation reject the command? |
| `command.origin` | string | caller context | Where did this command come from (http, workflow, reactor) |
| `command.event_count` | number | result | How many events were produced |
| `command.event_types` | string[] | result events | Type names of produced events |
| `error` | boolean | exception | Did an error occur? |
| `exception.message` | string | exception | Error message if failed |
| `exception.type` | string | exception | Error class/type |
| `exception.expected` | boolean | exception context | Was this a business rule rejection vs unexpected failure? |

### Event Store Metrics

| Attribute | Type | Source | Purpose |
|---|---|---|---|
| `eventStore.operation` | string | method | "readStream", "appendToStream", "readAll" |
| `eventStore.read.duration_ms` | number | timing | How long the read took |
| `eventStore.read.event_count` | number | result | Events returned |
| `eventStore.read.event_types` | string[] | result events | Types of events read |
| `eventStore.read.status` | string | result | success/failure |
| `eventStore.append.duration_ms` | number | timing | How long the append took |
| `eventStore.append.event_count` | number | input | Events being appended |
| `eventStore.append.event_types` | string[] | input events | Types of events appended |
| `eventStore.append.batch_size` | number | input | Same as event_count (explicit for batch context) |
| `eventStore.append.status` | string | result | success/failure |
| `stream.name` | string | input | Full stream name (e.g., "BankAccount-123") |
| `stream.type` | string | derived | Stream category (e.g., "BankAccount") |
| `stream.version.before` | number | read result | Stream version before append |
| `stream.version.after` | number | append result | Stream version after append |

### Consumer Metrics

| Attribute | Type | Source | Purpose |
|---|---|---|---|
| `consumer.source` | string | config | Which event store / stream being polled |
| `consumer.batch_size` | number | poll result | Events fetched this cycle |
| `consumer.poll_duration_ms` | number | timing | How long polling took |
| `consumer.processor_count` | number | config | Registered processors |
| `consumer.earliest_checkpoint` | number | processor checkpoints | Lowest checkpoint (polling start) |
| `consumer.lag` | number | derived | Gap: latest position - earliest checkpoint |
| `consumer.delivery.processor_id` | string | delivery context | Which processor got the batch |
| `consumer.delivery.duration_ms` | number | timing | How long delivery to processor took |
| `consumer.delivery.status` | string | result | success/failure |

### Processor Metrics (shared across archetypes)

| Attribute | Type | Source | Purpose |
|---|---|---|---|
| `processor.id` | string | config | Processor identifier |
| `processor.type` | string | archetype | "projector", "reactor", "workflow", "custom" |
| `processor.batch_size` | number | input | Events in this batch |
| `processor.event_types` | string[] | input events | Event types in batch |
| `processor.duration_ms` | number | timing | Total processing time |
| `processor.status` | string | handler result | "ack", "skip", "stop", "error" |
| `processor.checkpoint.before` | number | checkpoint store | Position before processing |
| `processor.checkpoint.after` | number | checkpoint store | Position after processing |
| `processor.lag_events` | number | derived | How far behind latest position |
| Links | SpanLink[] | event metadata | Back to originating command trace(s) |

### Projector-Specific Metrics

| Attribute | Type | Source | Purpose |
|---|---|---|---|
| `projector.collection` | string | config | Target collection/table name |
| `projector.upsert_count` | number | result | Documents/rows upserted |
| `projector.delete_count` | number | result | Documents/rows deleted |

### Reactor-Specific Metrics

| Attribute | Type | Source | Purpose |
|---|---|---|---|
| `reactor.side_effect` | string | handler | What action was triggered |
| `reactor.side_effect.duration_ms` | number | timing | Side effect duration |
| `reactor.side_effect.status` | string | result | success/failure of the side effect |

### Workflow-Specific Metrics

| Attribute | Type | Source | Purpose |
|---|---|---|---|
| `workflow.id` | string | router | Workflow instance ID |
| `workflow.type` | string | config | Workflow definition name |
| `workflow.input.type` | string | input message | What message triggered this step |
| `workflow.step` | string | processing | "route", "decide", "evolve" |
| `workflow.state.status` | string | state | Current state after processing |
| `workflow.state.transition` | string | state diff | "Pending → Finished" |
| `workflow.outputs` | string[] | decide result | Output message types |
| `workflow.outputs.count` | number | decide result | Number of outputs |
| `workflow.stream_position` | number | stream | Position in workflow stream |
| `workflow.decide.duration_ms` | number | timing | Time in decide function |
| `workflow.evolve.duration_ms` | number | timing | Time rebuilding state |
| `workflow.state_rebuild.event_count` | number | stream | Events replayed to rebuild state |
| Links | SpanLink[] | event metadata | Back to originating trace |

---

## Open Questions

1. **Event metadata for trace context**: The event store needs to carry traceId/spanId as event metadata for the link chain to work. How does the current event metadata type look? Is there room to add optional trace context fields, or does this need a migration?

2. **Consumer span granularity**: Should consumers produce one span per poll cycle (covering the whole batch + delivery to all processors), or one span per processor delivery? The former is simpler; the latter gives finer-grained timing.

3. **Projector/reactor-specific metrics**: The attributes I listed for projectors (upsert_count, delete_count) and reactors (side_effect) depend on the specific implementation (Pongo, PostgreSQL, etc.). Should the core observability define these attribute names as conventions, and leave it to each implementation to set them? Or keep the core generic?

4. **Workflow double-hop visibility**: Each hop in the double-hop (input routing → input storage → processing → output storage → output processing) could be a separate child span or just timing attributes on the main workflow span. The wide events philosophy says attributes. But the double-hop is complex enough that child spans might genuinely help debugging. Which approach?

5. **Backpressure metrics**: The consumer/processor article mentions backpressure as a future concern. Should the observability design account for backpressure signals now (e.g., `processor.processing_rate`), or is that premature?

6. **Naming conventions**: Should attribute names follow OTel semantic conventions where they exist (e.g., `messaging.batch.message_count` instead of `processor.batch_size`), or use emmett-specific naming throughout for consistency?

---

## Resolved Decisions (from initial discussion)

1. **Scope**: All areas -- command handling, event store, processors, projections, consumers, workflows
2. **Context propagation**: Both trace propagation (synchronous) AND links (async). Configurable.
3. **Sampling**: Define the interface, implement simple/noop initially. `sample_rate` in span data model.
4. **Env config**: Both env vars and programmatic, programmatic takes precedence.
5. **Event metadata**: Recorded messages should always carry traceId/spanId.
6. **Consumer/processor spans**: Autonomous traces. Processors link back to consumer poll span, not children of it. Same pattern as command→processor links.
7. **Conventions**: Core defines common attribute name conventions, implementations can extend with their own.
8. **Naming**: Hybrid -- OTel semantic conventions for standard stuff (http.*, error.*), emmett-specific for domain (command.*, workflow.*, eventStore.*).
9. **Workflow hops**: Default to timing attributes on one span, configurable to use child spans per hop for debugging.
10. **Backpressure**: Include lag metrics now (processor.lag_events, consumer.lag). Full rate/capacity metrics later.

---

## Architecture Discussion (follow-up session)

### Additional Sources

- [Flow-PHP Telemetry](https://norbert.tech/blog/2026-03-01/flow-php-telemetry-en/) -- Norbert Orzechowicz. Built own telemetry API independent of OTel SDK, OTLP-compatible output via separate bridge package. Three-tier: core API → OTLP bridge → framework bridges. Same philosophy as emmett's approach.
- [Gemini feedback](./feedback-gemini.md) -- External review of the plan. Raised concerns about context propagation bottleneck, exporter reliability, and the risk of maintaining a custom tracer.

### What the original plan.md got wrong

1. **Reinvented OTel from scratch.** Defined custom SpanKind, SpanStatus, OTLP wire format types, etc. This creates a maintenance burden -- every OTel spec change requires emmett updates.
2. **Treated OTLP compatibility as a core design constraint** rather than an exporter concern.
3. **Ignored Pino/Winston integration.** Users with existing logging setups had no way to plug them in.
4. **correlationId/causationId were an afterthought.** These are the event sourcing native observability concepts and should be first-class.
5. **Monolithic design.** One big tracer doing everything, instead of composed focused concerns like the past sample code.

### Architecture: Composition of Focused Concerns

Inspired by the past sample Java code pattern (MetricsFactory → EventStoreMetricsCollector → MetricsEventStoreWrapper). Three focused interfaces, composed by domain-specific collectors.

#### Focused Interfaces (user provides implementations)

Each interface is focused on one responsibility. User plugs in the implementation they want.

**1. Tracer** -- spans/operations with timing and attributes
- `startSpan(name, fn)` -- times an operation, supports nesting via AsyncLocalStorage
- `ActiveSpan.setAttributes(attrs)` -- annotate the current operation
- `ActiveSpan.spanContext()` -- get traceId/spanId for message metadata
- Implementations: OTel (creates real OTel spans via `@opentelemetry/api`), Pino (structured log line at end), ClickHouse (inserts row on completion), console, noop

**2. Meter** -- metrics (counters, histograms, gauges)
- `counter(name)` → `Counter.add(value, attributes)`
- `histogram(name)` → `Histogram.record(value, attributes)`
- `gauge(name)` → `Gauge.record(value, attributes)`
- Implementations: OTel (real OTel metrics), noop
- Maps directly to past sample's `MetricsFactory`

**3. Logger** -- structured log output
- `info/warn/error/debug(message, attributes)`
- User plugs in their own (Pino, Winston, console)
- Replaces current `tracer.ts` logging

#### past sample → emmett mapping

| past sample (Java) | emmett (TypeScript) |
|---|---|
| `MetricsFactory` | Tracer + Meter interfaces |
| `MetricsFactory.counter(name, tags)` | `meter.counter(name)` |
| `MetricsFactory.distribution(name, tags)` | `meter.histogram(name)` |
| `EventStoreMetricsCollector` | Domain collectors per archetype (CommandHandlerCollector, EventStoreCollector, etc.) |
| `MetricsEventStoreWrapper` (decorator) | Built into archetypes directly (emmett owns them, no wrapper needed) |
| `MetricsTimer.measure()` | `tracer.startSpan()` |
| `DataDogMetricsFactory` | OTel strategy implementation |
| `InMemoryMetricsFactory` | Noop strategy / Memory strategy for testing |

What's new vs past sample: spans with attributes, correlationId/causationId on messages, wide event attributes, pluggable to OTel/Pino/ClickHouse/console.

#### Domain Collectors

Maps to past sample's `EventStoreMetricsCollector` -- domain-aware, composed from the focused interfaces. Each collector knows what data matters for its archetype, exposing contextual helpers rather than generic `setAttribute` calls.

- **CommandHandlerCollector** -- instruments command handling
  - Span: `command.handle` with stream.name, command.event_count, command.event_types, command.status
  - Metrics: `command.handling.duration` histogram, `event.appending.count` counter
  - Auto-populates correlationId/causationId on produced events

- **EventStoreCollector** -- instruments event store operations
  - Span: `eventStore.readStream`, `eventStore.appendToStream`
  - Metrics: `stream.reading.duration`, `stream.appending.duration`, `stream.appending.size`, per-event-type counters
  - Same metric definitions as past sample's EventStoreMetricsCollector

- **ProcessorCollector** -- instruments processors/reactors/projectors
  - Span: `processor.handle` with processor.id, processor.type, batch_size, event_types
  - Metrics: `processor.processing.duration`, `processor.lag_events` gauge
  - Links back to originating command traces via event metadata

- **WorkflowCollector** -- instruments workflow steps
  - Span: `workflow.step` with workflow.id, workflow.type, input.type, outputs
  - Metrics: `workflow.decide.duration_ms`, `workflow.evolve.duration_ms`

No wrapper/decorator needed -- unlike past sample's `MetricsEventStoreWrapper`, emmett owns the archetypes (handleCommand, reactor, projector). Instrumentation is built directly into them, controlled by options.

#### Configuration

Follows `JSONSerializationOptions` pattern -- intersection type threaded through option types:

```typescript
type ObservabilityOptions = {
  observability?: {
    tracer?: EmmettTracer;
    meter?: EmmettMeter;
    logger?: EmmettLogger;
  };
};
```

Each is optional. Defaults to noop. User provides what they care about. Multiple strategies compose via `composite()`:

```typescript
observability: {
  tracer: composite(otel(), clickhouse(conn)),
  meter: otel(),
  logger: pino(myLogger),
}
```

Each tracer strategy receives the same data from `startSpan`. OTel creates spans. ClickHouse inserts rows. Both run from the same instrumentation call.

#### OTel Integration

OTel is one implementation of the focused interfaces, not a special case:
- OTel Tracer → creates real OTel spans via `@opentelemetry/api` → user's existing OTel context integrates naturally
- OTel Meter → creates real OTel metrics via `@opentelemetry/api`
- `@opentelemetry/api` dependency stays contained within the OTel implementations, not spread across emmett

Users with OTel SDK already running get emmett spans in their traces automatically. They can also use standard OTel API directly for their own custom instrumentation alongside emmett's auto-instrumentation.

#### emmett's API is contextual, not generic

OTel's API is generic because it has to be -- it doesn't know about event sourcing. emmett's collectors can be more contextual and less verbose because they know the domain. The collector knows what data matters for each archetype.

### correlationId / causationId

Independent from observability strategy. Always populated on message metadata.

- **causationId**: defaults to triggering message's ID (command ID for events from handleCommand, input event's messageId for processor reactions). User can override via event metadata.
- **correlationId**: configurable default strategy:
  - Independent UUID (generated at business boundary, propagated through chain across async boundaries)
  - OR mapped to traceId (from current span context)
  - User's choice. User can override per-operation. User can opt out.
- Both stored on `CommonRecordedMessageMetadata`. The observability strategy reads them and records in spans/metrics.

Why separate from traceId: traceId has a specific lifecycle -- it dies when the synchronous flow ends. In event sourcing, correlations span async boundaries (command → events → processor → new commands). correlationId persists in the event store and propagates through the entire business flow.

### Naming Conventions

OTel-aligned naming for the API surface (`startSpan`, `setAttributes`, `counter`, `histogram`). emmett-specific naming for domain attributes (`command.*`, `eventStore.*`, `processor.*`, `stream.*`, `workflow.*`).

### v1 Scope

Includes:
- All focused interfaces (Tracer, Meter, Logger) + noop defaults
- OTel implementations (Tracer + Meter via `@opentelemetry/api`)
- Pino/Winston/console Logger implementations
- Domain collectors for all archetypes: command handler, event store, processors, projections
- Workflow-specific instrumentation
- Auto-instrumentation for Express and Hono HTTP frameworks
- Composite strategies (combine multiple, e.g., OTel tracing + ClickHouse rows)
- Basic ClickHouse strategy (validates the pattern works for analytical backends)
- correlationId/causationId on message metadata
- Metrics: counters, histograms, gauges (v1, not deferred)

NOT in v1:
- Dashboard / Aspire-like UI
- Weaver schema integration
- DuckDB exporter (ClickHouse validates the pattern, DuckDB follows same shape)
- Vector DB exporters


# Observability Architecture — Discussion Conclusions

## Architecture: Composition of Focused Concerns

Inspired by the past sample Java code pattern. Three focused interfaces, composed by domain-specific collectors.

### Focused Interfaces (user provides implementations)

1. **Tracer** — spans/operations with timing and attributes
   - `startSpan(name, fn)` — times an operation, supports nesting via AsyncLocalStorage
   - `ActiveSpan.setAttributes(attrs)` — annotate the current operation
   - `ActiveSpan.spanContext()` — get traceId/spanId for message metadata
   - Implementations: OTel (creates real OTel spans via `@opentelemetry/api`), Pino (structured log at end), console, noop

2. **Meter** — metrics (counters, histograms, gauges)
   - `counter(name)` → `Counter.add(value, attributes)`
   - `histogram(name)` → `Histogram.record(value, attributes)`
   - `gauge(name)` → `Gauge.record(value, attributes)`
   - Implementations: OTel (real OTel metrics), noop
   - Maps directly to past sample's `MetricsFactory`

3. **Logger** — structured log output
   - `info/warn/error/debug(message, attributes)`
   - User plugs in their own (Pino, Winston, console)
   - Replaces current `tracer.ts` logging

### Domain Collectors (emmett builds these, compose Tracer + Meter + Logger)

Maps to past sample's `EventStoreMetricsCollector` pattern — domain-aware, uses the focused interfaces.

- **CommandHandlerCollector** — instruments command handling
  - Span: `command.handle` with stream.name, command.event_count, command.event_types, command.status
  - Metrics: `command.handling.duration` histogram, `event.appending.count` counter
  - Auto-populates correlationId/causationId on produced events

- **EventStoreCollector** — instruments event store operations
  - Span: `eventStore.readStream`, `eventStore.appendToStream`
  - Metrics: `stream.reading.duration`, `stream.appending.duration`, `stream.appending.size`, per-event-type counters
  - Same metric definitions as past sample's EventStoreMetricsCollector, translated to TypeScript

- **ProcessorCollector** — instruments processors/reactors/projectors
  - Span: `processor.handle` with processor.id, processor.type, batch_size, event_types
  - Metrics: `processor.processing.duration`, `processor.lag_events` gauge
  - Links back to originating command traces via event metadata

### No wrapper/decorator needed

Unlike past sample's `MetricsEventStoreWrapper`, emmett owns the archetypes (handleCommand, reactor, projector). Instrumentation is built directly into them, controlled by options. No separate wrapper class.

## Configuration

Follows `JSONSerializationOptions` pattern — intersection type threaded through option types.

```
type ObservabilityOptions = {
  observability?: {
    tracer?: EmmettTracer;
    meter?: EmmettMeter;
    logger?: EmmettLogger;
  };
};
```

Each is optional. Defaults to noop. User provides what they care about:
- Just tracing? Provide a tracer.
- Just metrics? Provide a meter.
- Both? Provide both.
- Nothing? Everything is noop, zero overhead.

Multiple strategies can be composed via `composite()`:
```
observability: {
  tracer: composite(otel(), clickhouse(conn)),
  meter: otel(),
  logger: pino(myLogger),
}
```
Each tracer strategy receives the same data from `startSpan`. OTel creates spans. ClickHouse inserts rows. Both run from the same instrumentation call.

## OTel Integration

OTel is one implementation of the focused interfaces, not a special case:
- OTel strategy for Tracer → creates real OTel spans → user's existing OTel context integrates naturally
- OTel strategy for Meter → creates real OTel metrics
- `@opentelemetry/api` dependency stays contained within the OTel implementations, not spread across emmett

Users with OTel SDK already running get emmett spans in their traces automatically.

## correlationId / causationId

Independent from observability strategy. Always populated on message metadata.

- **causationId**: defaults to triggering message's ID (command ID for events from handleCommand). User can override via event metadata.
- **correlationId**: configurable default strategy:
  - Independent UUID (generated at business boundary, propagated through chain)
  - OR mapped to traceId (from current span context)
  - User's choice. User can override per-operation. User can opt out.

Both stored on `CommonRecordedMessageMetadata`. Strategy can read them and record in spans/metrics.

## Naming Conventions

OTel-aligned naming for the API (`startSpan`, `setAttributes`, `counter`, `histogram`).
Emmett-specific for domain attributes (`command.*`, `eventStore.*`, `processor.*`, `stream.*`).

Rationale: OTel naming is industry-standard for the generic concepts. emmett adds domain-specific attribute names that OTel doesn't define.

## emmett's API is contextual, not generic

Unlike OTel's generic `span.setAttribute('key', value)`, emmett's collectors can expose domain-specific helpers that are more contextual and less verbose. The collector knows what data matters for each archetype.

## Metrics Catalog

Carried forward from feedback.md — the attribute/metric definitions for each archetype. See feedback.md "Metrics Catalog" section.

## v1 Scope

Includes:
- All focused interfaces (Tracer, Meter, Logger) + noop defaults
- OTel implementations (Tracer + Meter via `@opentelemetry/api`)
- Pino/Winston/console Logger implementations
- Domain collectors for all archetypes: command handler, event store, processors, projections
- Workflow-specific instrumentation (workflow implementation already exists)
- Auto-instrumentation for Express and Hono HTTP frameworks
- Composite strategies (combine multiple strategies, e.g., OTel tracing + Pino logging)
- Basic ClickHouse exporter (to validate the exporter interface works for analytical backends)
- correlationId/causationId on message metadata

NOT in v1:
- Dashboard / Aspire-like UI
- Weaver schema integration
- DuckDB exporter (ClickHouse validates the pattern, DuckDB follows same shape)
- Vector DB exporters

## Key Files to Modify

- `src/packages/emmett/src/observability/` — new tracer, meter, logger interfaces + domain collectors
- `src/packages/emmett/src/typing/message.ts` — add correlationId, causationId to CommonRecordedMessageMetadata
- `src/packages/emmett/src/commandHandling/handleCommand.ts` — add ObservabilityOptions, wire CommandHandlerCollector
- `src/packages/emmett/src/eventStore/eventStore.ts` — add ObservabilityOptions to ReadStreamOptions/AppendToStreamOptions
- `src/packages/emmett/src/processors/processors.ts` — add ObservabilityOptions to BaseMessageProcessorOptions
- `src/packages/emmett/src/projections/index.ts` — add ObservabilityOptions to ProjectionDefinition
- Existing tracer.ts — evolve or replace with new Logger interface
