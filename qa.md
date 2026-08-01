# Consumer Unification — Q&A

## Q1. Core mechanism

**Question:** The store consumers each hand-roll `reactor`/`projector`/`workflowProcessor` methods that wrap the generic `processor()` call. What shape should the generic consumer take?

**Answer (Oskar, verbatim):** "Both"
- Store consumers get **factory-injected convenience methods** — the generic `consumer()` gains `projector`/`reactor`/`workflowProcessor`, and each store injects its specific factory (e.g. `postgreSQLProjector`) when building the consumer, so each store consumer shrinks to supplying its factories + observability merge.
- The generic methods **also accept a pre-built processor instance** as an escape hatch, so any projector/reactor can be passed through regardless of store.

## Q2. Escape-hatch disambiguation

**Question:** How should the role methods (`projector`/`reactor`/`workflowProcessor`) tell an options object apart from an already-built processor passed as the escape hatch?

**Answer (Oskar, verbatim):** "It should be strongly typed and either use union type or explicit overload, whatever makes it work and be compatible with what we have"

## Q3. Factory wiring

**Question:** How should the store-specific processor factories be wired into the generic consumer, and what happens when none are supplied?

**Answer (Oskar, verbatim):** "Always inject explicitly"

Generic `consumer()` requires the factory set; no hidden in-memory default. Every store passes its trio (or subset). Each store's binding stays explicit at its own call site.

## Q4. Method surface / substitutability

**Question:** How precise should the generic consumer's method surface be, given each store injects a different subset of factories?

**Answer (Oskar, verbatim):** "The idea is to have the unified consumers layer that would allow to swithc implementations if used for commonly supported features, still, some consumers may have other features and we don't want to end up with the lowest0common denominator"

Interpretation: define a **unified consumer contract** covering the commonly-supported features (so a caller can code against it and swap store implementations), while each concrete store consumer still exposes its store-specific extras (e.g. `workflowProcessor` on PG/SQLite). The generic builder derives its actual method surface from the injected factory set — extra methods appear only when their factory is injected — and each store's concrete type stays assignable to the common unified type.

## Q5. Unified contract membership

**Question:** What belongs in the unified, switchable consumer contract that every store satisfies?

**Answer (Oskar, chosen option):** "Everything incl. workflowProcessor"

The unified contract = base `MessageConsumer` lifecycle + `reactor` + `projector` + `workflowProcessor`. Store-specific "other features" (Q4) are the ones *beyond* this trio. Since every store (PG, SQLite, Mongo, ESDB) is backed by an event store, `workflowProcessor` is treated as commonly supportable rather than PG/SQLite-only.

## Q6. Mongo/ESDB workflow gap

**Question:** Mongo and ESDB currently have no `workflowProcessor`. To satisfy the unified contract that includes it, what should happen for those two?

**Answer (Oskar, verbatim):** "Do we have the in memory workflow processor? If not then they should throw exception for now when used, we could add such not-implemented-yet-workflow-processor"

**Finding:** There is **no** in-memory workflow processor. Core exposes a store-agnostic `workflowProcessor` factory (`src/packages/emmett/src/workflows/workflowProcessor.ts`) plus `inMemoryProjector`/`inMemoryReactor` (`src/packages/emmett/src/processors/inMemoryProcessors.ts`), but no in-memory workflow sibling — a workflow needs a message store to persist output, which the in-memory processors lack.

**Decision:** Introduce a shared "not-implemented-yet" workflow processor placeholder that **throws** when used. Mongo and ESDB inject it so their consumers satisfy the unified contract at the type level, while making the unsupported state explicit at runtime. Native workflow support for Mongo/ESDB can be added later.

**Follow-up (Oskar, mid-turn):** "Ok, so we should also add gh issue for building such processor" — open a GitHub issue to build the real Mongo/ESDB workflow processor that replaces the throwing placeholder. Tracked as a spec deliverable.

## Q7. Backward compatibility

**Question:** How much can existing public API change? The store consumer factories and their exported types are used by callers today.

**Answer (Oskar, verbatim):** "In general, the usage should be the same, so as long as the current api still works, then I'm good, if there are needed some slight breaking changes I'm fine, but you need to list them, plus if we manage to unify the api, then we can drop methods from consumers if from the generic is enough. Is that an answer satisfying your question? If not ask for more grounding it with code research"

Decision: preserve current usage — existing factory functions and their behaviour keep working. Slight breaking changes are acceptable **only if explicitly listed** in the spec. Where the unified generic method fully covers a store's hand-rolled method, that redundant per-store method implementation is dropped in favour of the injected-factory path.

## Q8. Unified type name

**Question:** What should the new unified consumer contract type be named?

**Answer (Oskar, chosen option):** "Extend MessageConsumer"

No new type name. The role methods (`reactor`, `projector`, `workflowProcessor`) are folded directly into the existing `MessageConsumer` type, so the generic `consumer()` output already carries them. Store consumer types narrow the method option types via their own declarations; no separate `EventStoreConsumer`/`UnifiedEventStoreConsumer` type is introduced.

## Q9. Escape-hatch observability

**Question:** When a caller passes an already-built processor via the escape hatch (not options), how should consumer-level observability be handled?

**Answer (Oskar, verbatim):** "I don't understand why would it need to change"

Decision: **register as-is.** A pre-built processor already carries its own observability; passing it through the escape hatch does not merge or alter anything. Only the options-path calls get consumer-level observability merged in (the existing `withMergedObservability` behaviour, now shared in one place).

## Q10. Why keep `withMergedObservability`

**Question (Oskar, verbatim):** "why do we need withMergedObservability? we always want to have observability in place"

**Finding:** `mergeObservability(a, b)` is `{ ...a, ...b }` over a bag of instances (`tracer`, `meter`, `logger`, `pollTracing`, `contextGenerator`, `attributeTarget`), not an on/off toggle. Observability is *always* present regardless — unconfigured processors resolve to noop tracer/meter/logger, and there is a separate `mergeWithDefaultObservability(globalDefault, processorObservability)` step at run time. `withMergedObservability` is only the **middle inheritance link**: it pushes the consumer-level observability config down as the base for every processor the consumer builds. Effective precedence: `globalDefault < consumer-level observability < per-processor observability`. Dropping it doesn't remove observability — it only stops the consumer's config from reaching its processors unless restated per processor.

**Answer (Oskar, chosen option):** "Keep inheritance, one copy"

Decision: preserve the consumer→processor observability inheritance, but implement it once in the generic builder instead of copy-pasting it in all four store consumers. Non-breaking.

---

# Typing redesign (supersedes the earlier "extend MessageConsumer via `& { overrides }`" idea)

Context: folding `reactor`/`projector`/`workflowProcessor` into the base while each store type is `MessageConsumer<Msg> & { narrowed overrides }` turns the base + narrowed signatures into an **overload set**; the generic signature shadows contextual inference, so a store handler's context (e.g. `ctx.execute`) fails to type. Compiler-proven in `poc/full.ts`. Oskar's fix: make `MessageConsumer` generic over the option types + handler context, all defaulting, so stores **instantiate** the base rather than override it — one signature per method, no overload set. Compiler-proven in `poc/generic.ts` (exit 0: PG context infers, switchability holds, garbage rejected, conditional projector vanishes for command-only).

## Q11. Generic parameter granularity

**Question:** How should `MessageConsumer`'s new generic parameters be shaped, given store option types look like `ProjectorOptions<Event, Metadata, HandlerContext> & PostgreSQLProcessorOptionsBase`?

**Answer (Oskar, chosen option):** "Option types directly"

`MessageConsumer` is parameterized on the **finished option types** plus the handler context, each with a default:

```ts
type MessageConsumer<
  Msg = Message,
  ProjectorOpts = ProjectorOptions<Msg & AnyEvent, ...>,
  ReactorOpts = ReactorOptions<Msg, ...>,
  WorkflowOpts = WorkflowProcessorOptions<...>,
  HandlerContext = MessageHandlerContext,
> = { ...role methods typed from these params... };
```

Stores instantiate directly, e.g. `PostgreSQLEventStoreConsumer<Msg> = MessageConsumer<Msg, PostgreSQLProjectorOptions<...>, PostgreSQLReactorOptions<...>, PostgreSQLWorkflowProcessorOptions<...>, PostgreSQLProcessorHandlerContext>`. No `& { overrides }`, so no overload shadowing. Most explicit; no cleverness.

## Q12. Drop the standalone `processor()` method

**Question (Oskar, verbatim):** "we don't need processor: <P extends MessageProcessor<Msg>>(p: P) => P; - as reactor is processor"

Rationale: a reactor is the general processor (`projector` internally calls `reactor` with `type: PROJECTOR`), and `reactor`'s escape hatch already accepts any pre-built `MessageProcessor<Msg>`. So the low-level `processor()` is redundant on the public surface — registering any pre-built processor goes through `reactor(prebuilt)`. Compiler-proven in `poc/generic.ts` (exit 0): `reactor(anyPrebuiltProcessor)` and even `reactor(builtProjector)` type-check.

**Decision:** Remove the public `processor()` method from `MessageConsumer`. Internal registration becomes a private helper the role methods call.

**Breaking change to list:** `processor()` is public today and returns the passed processor at its exact type (`<P extends MessageProcessor>(p: P) => P`); callers using it must switch to `reactor(prebuilt)`, which returns the widened `MessageProcessor<Msg>`.

## Q13. Builder option-type resolution

**Question:** How should the generic `consumer()` builder determine the option-type params for the `MessageConsumer` it returns?

**Answer (Oskar, chosen option):** "Infer from factories"

The builder is generic over the injected factory parameter types and **infers** `ProjectorOpts`/`ReactorOpts`/`WorkflowOpts`/`HandlerContext` from `processorFactories`. Stores pass their real factories (`postgreSQLProjector`, etc.) and get back a correctly-typed `MessageConsumer` with no explicit type arguments. Least boilerplate at each store call site.

**Compiler finding (`poc/infer.ts`) — a hard constraint:** TypeScript has **no partial type-argument inference**. If the `consumer(...)` call supplies *any* explicit type argument, the remaining params fall back to their defaults (`never`) instead of being inferred — which breaks the option typing. Proven: `consumer<Msg>({...})` fails (`MessageConsumer<Msg, never, never, never>` not assignable); `consumer({...})` with **zero** explicit type args succeeds (exit 0), inferring `Msg`, `PO`, `RO`, `WO` all from the factory closures.

**Consequence for implementation:** the `consumer({...})` call inside each store wrapper must pass **no** explicit type arguments. Today's stores call `consumer<ConsumerMessageType, MetadataType, HandlerContext>({...})` with three explicit args — those must be removed, and `Msg`/metadata/context must instead flow from the runtime arguments (`source` + `processorFactories`). The store wrapper still fixes `Msg` via its own function type parameter by typing the factory closures it passes in. See Q14.

**Further compiler finding (`poc/infer2.ts`, exit 0):** with zero explicit type args, the builder also infers **metadata** (from `source: MessageSource<Msg, Meta>`) and **handler context** (from `scope`/factories). Inside handlers, PG metadata (`meta.streamPosition`) and PG context (`c.execute`) both type correctly, and switchability (`const asBase: MessageConsumer<AnyEvent> = pg`) holds. Full design validated end-to-end.

## Q14. Handler context placement

**Question:** Handler context as its own defaulting `MessageConsumer` generic param, or carried inside the option types?

**Answer (Oskar, verbatim):** "Whatever makes it simpler, obey typing and less ceremony"

**Decision: embedded in the option types** (single source of truth). `MessageConsumer`'s public generic params are `Msg` + the three option types (`ProjectorOpts`, `ReactorOpts`, `WorkflowOpts`); metadata and handler context ride inside those option types (`ProjectorOptions<Event, Meta, Ctx>`), where the handler callbacks already pick them up correctly (proven). No separate `Ctx` param on `MessageConsumer`, so there's nothing to keep consistent. The builder still infers `Meta`/`Ctx` internally for `source`/`scope`, but they are not surfaced as return-type params.

## Q15. Naming — capability/usage, not implementation

**Question (Oskar, verbatim):** "Please also ensure that naming you use (e.g. processorFactories) are not vague, or focused on implementation, but focused on capability and usage perspective MessageConsumerSetup"

Rejected as "even worse": `supportedProcessors`, `capabilities`, `processorProviders`, `processorTypes`, `processing` — collective-noun/pattern words.

**Decisions:**
- **No collective wrapper for the injected store builders.** The definition states each **inline** as a top-level field — `projector`, `reactor`, `workflowProcessor` — each a store builder `(options) => MessageProcessor`. Most usage-focused: the definition literally says what its projector/reactor/workflow are. No collision (`MessageConsumerOptions` has no such fields). Replaces the earlier `processorFactories` / `ConsumerProcessorFactories`.
- **`MessageConsumerSetup` → `MessageConsumerDefinition`** — frames it as the full definition of a consumer a store provides, not the act of setting up. Pairs with the user-facing `MessageConsumerOptions`.
- **`notImplementedWorkflowProcessor` → `unsupportedWorkflowProcessor`** — capability-focused (this store doesn't support workflows) rather than implementation-status wording. *(Applied for consistency; flag for confirmation.)*
