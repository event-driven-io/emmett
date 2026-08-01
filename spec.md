# Spec: Unify the consumer processor methods across stores

## Background

Emmett has a generic consumer builder, `consumer()`, in
[consumers.ts](src/packages/emmett/src/consumers/consumers.ts). It exposes a
low-level `processor(processorInstance)` that registers any already-built
`MessageProcessor`.

On top of it, each store ships its own consumer factory:

- [postgreSQLEventStoreConsumer](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts)
- [sqliteEventStoreConsumer](src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts)
- [mongoDBEventStoreConsumer](src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.ts)
- [eventStoreDBEventStoreConsumer](src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts)

Every one of them re-implements the same trio of convenience methods —
`reactor`, `projector`, and (PG/SQLite only) `workflowProcessor` — each of which
merely:

1. runs the caller's options through an **identical** `withMergedObservability`
   helper (copy-pasted in all four files), then
2. calls the store's real processor factory (`postgreSQLProjector`,
   `sqliteReactor`, `mongoDBProjector`, `inMemoryReactor`, …), then
3. registers the result via `messageConsumer.processor(...)`.

They also repeat the same `{ ...messageConsumer, get isRunning() {...} }` return
shape. That is real, mechanical duplication, and the generic consumer lacks the
ergonomic role methods entirely.

## Goal

Provide **one unified consumer layer** so that:

- The generic `MessageConsumer` itself carries the `reactor`, `projector`, and
  `workflowProcessor` methods.
- A caller can code against that unified surface and **switch store
  implementations** for the commonly-supported features.
- Each store still keeps its own store-specific extras — we do **not** collapse
  to a lowest-common denominator.
- The duplication (`withMergedObservability`, the return spread, the three
  wrapper methods) lives in exactly one place.

## Decisions (from Q&A — see [qa.md](qa.md))

1. **Both** an injected-factory path and a pre-built-processor escape hatch (Q1).
2. Disambiguation between "options" and "pre-built processor" is **strongly
   typed** — union type or explicit overloads — never runtime duck-typing as the
   public contract (Q2).
3. Store-specific builders are **always provided explicitly** to the generic
   builder; no hidden default builders (Q3).
4. There is a **unified consumer layer** that lets callers switch
   implementations for the commonly-supported features, while stores may still
   expose extra features — no lowest-common denominator (Q4).
5. The unified contract includes **`reactor` + `projector` + `workflowProcessor`**
   (Q5).
6. There is **no** in-memory workflow processor. Mongo and ESDB inject a shared
   **throwing "not-implemented-yet" workflow processor** so they satisfy the
   contract at the type level but fail fast at runtime (Q6). A GitHub issue
   tracks building the real one.
7. **Backward compatible**: current usage keeps working; slight breaking changes
   allowed **only if listed** here; drop per-store methods where the generic one
   suffices (Q7).
8. **Extend `MessageConsumer`** — fold the role methods into the existing type;
   no new `EventStoreConsumer` type name (Q8).
9. The escape hatch **registers a pre-built processor as-is** — its observability
   is untouched. Only the options path merges consumer-level observability (Q9).
10. **Typing mechanism:** `MessageConsumer` is **generic over the option types**,
    each defaulting to the core generic type; stores **instantiate** it rather
    than `& { override }` it (Q11). This avoids the overload-shadowing that
    intersecting a folded base with narrowed overrides causes. Metadata and
    handler context ride inside the option types — no separate context param
    (Q14).
11. **No public `processor()`** — a reactor is the general processor, so
    `reactor(prebuilt)` is the one escape hatch for registering any processor
    (Q12).
12. **Builder infers** the option types (and metadata/context) from the inline
    store builders; the `consumer({...})` call must pass **zero** explicit type
    args or TS drops to `never` defaults (Q13).
13. **Naming (capability/usage):** no collective wrapper — the definition states
    its `projector`/`reactor`/`workflowProcessor` builders inline;
    `MessageConsumerSetup` → `MessageConsumerDefinition`;
    `notImplementedWorkflowProcessor` → `unsupportedWorkflowProcessor` (Q15).

## Design

### 1. Fold the role methods into `MessageConsumer`

In [consumers.ts](src/packages/emmett/src/consumers/consumers.ts), fold the role
methods into `MessageConsumer` by making it **generic over the option types**,
each with a default. A store then *instantiates* the base with its own option
types — it does **not** glue overrides on with `&`. `reactor` and
`workflowProcessor` are always present; `projector` stays conditional on the
message type carrying events. Metadata and handler context ride **inside** the
option types (`ProjectorOptions<Event, Metadata, HandlerContext>`), which is a
single source of truth (Q14) — there is no separate context param on
`MessageConsumer`:

```ts
export type MessageConsumer<
  ConsumerMessageType extends Message = any,
  ProjectorOpts = ProjectorOptions<ConsumerMessageType & AnyEvent>,
  ReactorOpts = ReactorOptions<ConsumerMessageType>,
  WorkflowOpts = WorkflowProcessorOptions<...>,
> = Readonly<{
  // …existing lifecycle: consumerId, isRunning, init, start, stop, close,
  // whenStarted, whenProcessed, whenCaughtUp, processors…
  // NOTE: no `processor()` method — see below.

  reactor: (o: ReactorOpts | MessageProcessor<ConsumerMessageType>)
    => MessageProcessor<ConsumerMessageType>;
  workflowProcessor: (o: WorkflowOpts)
    => MessageProcessor<ConsumerMessageType>;
}> &
  (AnyEvent extends ConsumerMessageType
    ? Readonly<{
        projector: (
          o: ProjectorOpts | MessageProcessor<ConsumerMessageType & AnyEvent>,
        ) => MessageProcessor<ConsumerMessageType & AnyEvent>;
      }>
    : object);
```

Each store's exported consumer type is just an instantiation:

```ts
export type PostgreSQLEventStoreConsumer<Msg extends AnyMessage = any> =
  MessageConsumer<
    Msg,
    PostgreSQLProjectorOptions<Msg & AnyEvent>,
    PostgreSQLReactorOptions<Msg>,
    PostgreSQLWorkflowProcessorOptions<...>
  >;
```

The generic params are additive with defaults, so existing external references to
`MessageConsumer<SomeMsg>` keep compiling. This is the "switchable layer": every
store instantiation stays assignable to the default `MessageConsumer<Msg>`.

**No `processor()` method (Q12).** A reactor *is* the general processor
(`projector` internally calls `reactor` with `type: PROJECTOR`), and `reactor`'s
escape hatch already accepts any pre-built `MessageProcessor<Msg>`. So the
low-level `processor()` is dropped from the public surface; registering any
pre-built processor goes through `reactor(prebuilt)`. Internal registration
becomes a private helper the role methods call. *(Breaking change, listed below.)*

> **Typing PoC — verified end-to-end (TS 6.0.3, `strict`, scratchpad
> `poc/generic.ts`, `poc/builder.ts`, `poc/infer.ts`, `poc/infer2.ts`; all exit
> 0):**
>
> 1. **Generic-over-option-types works, arrow syntax, single signature per
>    method.** A store instantiates the base and its handlers get the store's own
>    context and metadata — `each: (event, meta, ctx) => ctx.execute(...)` and
>    `meta.streamPosition` both type correctly. This is precisely what the
>    earlier `MessageConsumer<Msg> & { overrides }` shape broke: intersection made
>    the two `projector` signatures an **overload set**, and the generic one
>    shadowed contextual inference (`ctx` came out as the base context). The
>    generic-param instantiation avoids the overload entirely.
> 2. **Switchability holds soundly.** `const asBase: MessageConsumer<AnyEvent> =
>    pgConsumer` compiles, because store option types add only **optional** fields
>    and store contexts *extend* the base context — the safe side of variance.
>    Guardrail: if a store ever adds a **required** option field it stops being
>    substitutable for the base on that method, and the compiler will say so.
> 3. **The `Options | MessageProcessor` union** type-checks both call styles and
>    rejects invalid args; `reactor(prebuiltProjector)` registers any processor.
> 4. **Conditional `projector`** correctly vanishes for a command-only
>    (`AnyEvent extends Msg` false) consumer.

### 2. Inject the factories into the builder

`MessageConsumerSetup` is renamed **`MessageConsumerDefinition`** (it defines the
consumer a store provides; pairs with the user-facing `MessageConsumerOptions`).
The store's per-role builders are stated **inline** as top-level fields —
`projector`, `reactor`, `workflowProcessor` — each a plain
`(options) => MessageProcessor`. No collective wrapper (Q15): the definition
literally says what its projector/reactor/workflow are. There is no collision —
`MessageConsumerOptions` has no such fields. Each store passes closures wrapping
its real builders, so any per-call massaging (e.g. SQLite building a
`messageStore` from the connection) stays inside the store's closure:

```ts
export type MessageConsumerDefinition<...> = MessageConsumerOptions<...> & {
  source: MessageSource<...>;
  scope?: MessageConsumerScope<...>;
  batchSize?: number;
  batchDeadlineInMs?: number;
  hooks?: ConsumerHooks;

  // inline store builders — each `(options) => MessageProcessor`
  reactor: (options: ReactorOpts) => MessageProcessor<...>;
  projector?: (options: ProjectorOpts) => MessageProcessor<...>;
  workflowProcessor: (options: WorkflowOpts) => MessageProcessor<...>;
};
```

The builder **infers** the option-type params from the inline store builders
(Q13) — stores pass their real builder functions and get a correctly-typed
`MessageConsumer` back with no explicit type arguments.

> **Hard inference constraint (Q13, `poc/infer.ts`).** TypeScript has **no
> partial type-argument inference**: if the `consumer(...)` call supplies *any*
> explicit type argument, the remaining params fall back to their defaults
> (`never`) instead of being inferred, which breaks the option typing. Therefore
> the `consumer({...})` call inside each store wrapper must pass **zero** explicit
> type arguments. Today's stores call
> `consumer<ConsumerMessageType, MetadataType, HandlerContext>({...})` with three
> explicit args — **those must be removed**. `Msg`, metadata, and handler context
> all infer from the runtime arguments (`source: MessageSource<Msg, Meta>`,
> `scope`, and the inline `projector`/`reactor`/`workflowProcessor` builders); the store wrapper fixes `Msg` via its own
> function type parameter by typing the factory closures it passes in. Verified in
> `poc/infer2.ts` (exit 0): metadata and context infer correctly this way.

The builder implements each role method once, registering through a private
helper (there is no public `processor()` anymore):

```ts
const register = (factory, optionsOrProcessor) =>
  isMessageProcessor(optionsOrProcessor)
    ? registerProcessor(optionsOrProcessor)            // escape hatch: as-is
    : registerProcessor(factory(withMergedObservability(optionsOrProcessor)));
```

- `isMessageProcessor` is an internal type guard (checks for the
  `MessageProcessor` shape — `id` + `handle` + `init`/`close`). The **public**
  method signatures are the strongly-typed `Options | MessageProcessor` unions
  from §1; the guard is only the implementation-side discriminator, not the
  contract.
- `registerProcessor` is the internal helper that pushes the built processor into
  the consumer's processor list (what the old public `processor()` did).
- `withMergedObservability` moves **into core** ([consumers.ts](src/packages/emmett/src/consumers/consumers.ts))
  and is deleted from all four store files. **Why it exists:** observability is
  always present regardless (unconfigured processors resolve to noop
  tracer/meter/logger, and a separate `mergeWithDefaultObservability` step runs
  at processor run time). This merge is *only* the inheritance link that pushes
  the consumer-level observability config down as the base for every processor
  the consumer builds — effective precedence
  `globalDefault < consumer-level observability < per-processor observability`.
  Kept because configuring a tracer once on the consumer should flow to all its
  processors; unifying it just removes the four copies.
- A `consumer({ source })` call with no store builders (`projector`/`reactor`/
  `workflowProcessor`) exposes only the lifecycle; the role methods are wired
  from whichever builders are provided.

### 3. Shared throwing workflow placeholder

Add to core (e.g. `src/packages/emmett/src/workflows/`):

```ts
export const unsupportedWorkflowProcessor = (_options: unknown): never => {
  throw new EmmettError(
    'workflowProcessor is not yet supported for this event store',
  );
};
```

Mongo and ESDB inject this as their `workflowProcessor` factory. The method
exists on their consumer type (contract satisfied) and throws a clear error when
called. Tracked for real implementation by a GitHub issue.

### 4. Rewrite the four store consumers as thin wrappers

Each store factory keeps its **exact current public signature** and:

- builds its `source`, `scope`, and `hooks` as it does today,
- calls `consumer({ ...options, source, scope, hooks, projector, reactor, workflowProcessor })`
  with its inline store builders,
- returns the result directly — no `{ ...messageConsumer, get isRunning }`
  spread, no per-store `withMergedObservability`, no hand-rolled `reactor` /
  `projector` / `workflowProcessor` bodies.

Store builders per consumer:

| Store    | reactor              | projector          | workflowProcessor                                   |
| -------- | -------------------- | ------------------ | --------------------------------------------------- |
| Postgres | `postgreSQLReactor`  | `postgreSQLProjector` | `postgreSQLWorkflowProcessor`                    |
| SQLite   | `sqliteReactor`      | `sqliteProjector`  | closure over `sqliteWorkflowProcessor` injecting `messageStore` from the connection |
| Mongo    | `changeStreamReactor`| `mongoDBProjector` | `unsupportedWorkflowProcessor`                   |
| ESDB     | `inMemoryReactor`    | `inMemoryProjector`| `unsupportedWorkflowProcessor`                   |

The observability merge now happens once inside the builder, using the
consumer-level `options.observability` the store already forwards.

## Backward compatibility & breaking changes

Preserve all four store factory function names, signatures, and the behaviour of
their existing methods. Callers that use `postgreSQLEventStoreConsumer(...)`,
`.projector(...)`, `.reactor(...)`, `.workflowProcessor(...)` recompile
unchanged.

**Potential slight breaking changes — to confirm during implementation:**

1. **Mongo & ESDB consumer types gain `workflowProcessor`.** Purely additive to
   the type; calling it throws at runtime until the real one lands. No existing
   caller relied on its absence.
2. **`MessageConsumer` gains role methods + generic params.** Additive: the new
   option-type params have defaults, so `MessageConsumer<Msg>` keeps compiling.
   Any code structurally typing a `MessageConsumer` (e.g. a hand-written stub)
   would now be missing members. Unlikely, but listed.
3. **`processor()` is removed from `MessageConsumer` (Q12).** It was public and
   returned the passed processor at its exact type (`<P>(p: P) => P`); callers
   must switch to `reactor(prebuilt)`, which returns the widened
   `MessageProcessor<Msg>`. Direct core `consumer({ source })` callers that
   registered via `.processor(...)` are affected.
4. If the internal `isMessageProcessor` guard were ever reachable by a caller
   passing an object that is *both* options-shaped and processor-shaped, the
   guard would treat it as a processor. Options types have no `handle`/`id`, so
   this cannot happen with the real option types; noted for completeness.

If implementation surfaces any further break, add it here before merging.

## Testing (TDD)

Write the failing tests first, per package. Assert every relevant field, keep
handlers deterministic (see repo testing convention).

1. **Generic builder — options path.** `consumer({ source, projector, reactor })`
   `.projector(options)` / `.reactor(options)` registers a processor, processes
   a batch, and merges consumer-level observability into the built processor.
2. **Generic builder — escape hatch.** `.projector(prebuiltProcessor)` registers
   the instance untouched (observability not re-merged) and processes.
3. **Inference.** A store wrapper calling `consumer({ source, scope, projector,
   reactor, workflowProcessor })` with **zero** explicit type args gets back a consumer
   whose `projector`/`reactor`/`workflowProcessor` carry the store's option
   types, metadata, and handler context (compile-time assertion test).
4. **Each store, unchanged behaviour.** Existing PG/SQLite/Mongo/ESDB consumer
   tests keep passing; add coverage that `.reactor`/`.projector` still work
   end-to-end through the injected factories.
5. **Mongo/ESDB `workflowProcessor` throws** a clear `EmmettError`.
6. **Switchability.** A test that codes against `MessageConsumer<Msg>` and runs
   the same projector/reactor registration against two different store consumers,
   proving the unified surface is substitutable.

Unit, integration, and end-to-end coverage all required (no test type skipped).

## Deliverables

1. Core changes in [consumers.ts](src/packages/emmett/src/consumers/consumers.ts):
   `MessageConsumer` generic over its option types, `MessageConsumerSetup`
   renamed `MessageConsumerDefinition` with inline `projector`/`reactor`/
   `workflowProcessor` builders, shared `withMergedObservability`, single
   role-method implementation with the escape-hatch guard, `processor()` removed.
2. `unsupportedWorkflowProcessor` placeholder in core `workflows/`.
3. The four store consumers rewritten as thin wrappers passing their inline builders.
4. Full test suite per §Testing.
5. **GitHub issue**: build the real Mongo/ESDB (event-store-backed) workflow
   processor to replace the throwing placeholder.
6. This spec and [qa.md](qa.md) committed.
