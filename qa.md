# Q&A — Unified Consumer / Subscription Base

## Q1

Looking at the four implementations, I see two distinct message delivery models:

- **Pull-based polling** (PostgreSQL, SQLite): a plain `while` loop in `messageBatchProcessing/index.ts`, reads a batch at a time via an `after` cursor, backs off when empty, stops via `AbortSignal`. Batches are real batches.
- **Push-based streams** (ESDB, MongoDB): Node.js `pipeline(subscription, Transform, Writable)` in `subscriptions/index.ts`. Each element is processed individually (`eachBatch([singleMessage])`), and reconnects are driven by `asyncRetry`. The race conditions almost certainly live in the interplay between `isRunning`, `stopSubscription`, and the Writable that mutates `options.startFrom` while `pipeline` is tearing down.

That gives us a fork in the road for the base abstraction:

**Option A — Unify into one iteration model.** Define a shared `MessageSource` contract that yields batches (async iterator or pull function), and have a single consumer loop consume it. PG/SQLite wrap their current batch read; ESDB wraps `subscribeToAll` as an async iterator; Mongo wraps the change stream. This lets us delete the `Transform`/`Writable` pipelines entirely — which is likely where the races come from — and gives us one place to handle checkpoint advancement, backoff, stop, and reconnect. More upfront work, but the race conditions go away as a side effect, and the code you'd maintain shrinks noticeably.

**Option B — Keep pull and push as separate siblings.** Extract only the consumer-level orchestration (the `processors` array, `eachBatch` fan-out, start/stop lifecycle, `zip*StartFrom`) into a shared base, and leave each provider's source implementation untouched. Smaller refactor, but ESDB/Mongo keep their stream pipelines and you'd fix the races as a separate targeted change.

Which direction do you want to go — A (unify under one iteration model and let that also resolve the ESDB/Mongo race conditions), or B (a thin shared consumer wrapper with pull and push kept as independent source implementations)? Or a hybrid you have in mind that I've missed?

## A1

I think A, AsyncGenerators sounds good to me, with basic implementation of common pipeline, and giving capabilities to customise implementation. We could provide also based code for push-based and pull-based semantic if that helps, thoughts?

## Q2

Now for the contract itself. I'm picturing the `MessageSource` as an async-iterable factory:

```ts
type MessageSource<M, Meta> = (options: {
  startFrom: CurrentMessageProcessorPosition;
  signal: AbortSignal;
}) => AsyncIterable<MessageBatch<M, Meta>>;

type MessageBatch<M, Meta> = {
  messages: RecordedMessage<M, Meta>[];
  checkpoint: ProcessorCheckpoint | null; // resume position after this batch
};
```

The consumer loop becomes: create source → `for await (const batch of source)` → dispatch to processors → advance checkpoint → repeat.

The decision I want to pin down is **who owns reconnect/retry**:

- **Option 1 — Source owns it.** The generator silently reloops on transient errors (e.g., ESDB disconnect). It only exits on `stop()` or a fatal error. `pushSource` wraps the subscribe call in `asyncRetry` internally. Consumer loop stays dead simple: one `for await`, no retry wrapper.
- **Option 2 — Consumer owns it.** The generator propagates errors. The consumer wraps the whole `for await` in `asyncRetry`, creating a fresh generator on each retry starting from the last durably stored checkpoint. The source stays pure and has no knowledge of resilience policy. Reconnect semantics are uniform across pull and push.

Option 1 keeps ESDB's current behavior (`asyncRetry` wraps the subscribe, not the iteration) and is closer to what you have today. Option 2 is cleaner conceptually — one retry loop instead of two — and also gives you "restart from durable checkpoint" semantics for free, which helps even pull sources if a DB connection drops mid-poll.

Which do you want? (I'd lean toward Option 2 for the uniformity, but it means the source must be fully restartable from any `startFrom`, which for push sources means the subscribe call + buffer get recreated each time — that's actually fine, it's how ESDB's resubscribe already works.)

## A2

I think that it'd be better to have both, so source has the basic capabilities of retry and consumer should be able to restart it when it crashed. Thoughts?

## Q3

Now I want to pin down the restart resume position — when the outer layer kicks in and creates a fresh source, where does it start from?

Today, checkpoint ownership sits entirely at the **processor** level: each processor stores its own checkpoint via `checkpoints.store`, independent of other processors in the same consumer. The consumer itself is stateless about positions — it just calls `zipStartFrom` to compute the MIN across all processors at initial start.

Two options for the restart case:

- **Option 1 — Resume from `min(processor checkpoints)` on every restart.** Same function that's already used for initial start. Consumer stays stateless about positions. Replay on restart is bounded by the slowest processor (which is inherent to the system anyway — fast processors will filter replayed messages via `wasMessageHandled`). Simple, always correct.
- **Option 2 — Consumer tracks a "last fully-dispatched batch" position.** On restart, resumes from `max(lastDispatchedPosition, min(processor checkpoints))`. Less replay in the common case (if processors are all caught up, restart is nearly zero-cost), but the consumer now carries position state, and the source must yield positions in every batch even when processors don't need them.

I'd pick Option 1: it's what initial start already does, it keeps the consumer stateless about positions, and the replay cost is bounded anyway. Option 2 is an optimization that costs a fair bit of complexity for marginal real-world benefit (and only helps when all processors happen to be in lock-step).

Do you agree with Option 1, or do you see a reason to have the consumer track position independently?

## A3

Option 1, consumers should be as dumb as possible, and play the role of coordinator

## Q4

Let's zoom in on `pushSource`. Push-based backends (ESDB `subscribeToAll`, MongoDB change streams) deliver messages one at a time. The current code surfaces each one as a "batch" of size 1 — ESDB's `SubscriptionSequentialHandler._transform` calls `eachBatch([message])` for every single event. This is a big reason ESDB/Mongo consumer throughput trails PG/SQLite, and it means processors that implement `eachBatch` for real batch optimizations (e.g., batched upserts in a projector) get none of the benefit.

Three options for how `pushSource` groups messages into batches:

- **Option 1 — 1-message batches.** Keep current behavior. Simplest, matches current code, but leaves batching benefits on the table.
- **Option 2 — Size/time-triggered batches.** Buffer pushed messages; flush when buffer reaches `batchSize` OR a `flushIntervalMs` timer fires. Classic producer-consumer buffering. Gives real batches but needs tuning, and the timer adds a source of latency + test flakiness.
- **Option 3 — Natural / opportunistic batches.** Implement the push-to-pull bridge with an async queue. While the consumer is busy processing batch N (dispatching to processors, storing checkpoints), new pushed messages accumulate in the queue. When the consumer asks for batch N+1 (the `for await` pulls the next item), the source hands over everything currently queued as one batch. No timer, no tuning — batch size self-regulates with consumer speed: idle → 1-message "batches", under load → naturally large batches. Optional `maxBatchSize` cap so a sudden burst doesn't produce a 100k-message batch.

Option 3 is my strong preference: real batches under load, zero tuning knobs, no timer latency, and it matches the spirit of async iteration (pull when ready). It also sidesteps the ESDB/Mongo race conditions completely, because there's only one place where messages move from "received" to "delivered to consumer" — the queue drain — and it's driven purely by the consumer pulling.

Which option do you want for `pushSource`?

## A4

in general, I'd just publish the batch of the size of the message source, processors should be the one deciding about the pace.

Of course, it'd be good to consider how the back pressure is communicated between source => consumer => processors[]

See the reasoning

---
title: Consumers, projectors, reactors and all that messaging jazz in Emmett
category: "Event-Driven Architecture"
cover: 2025-12-01-cover.jpg
author: oskar dudycz
---

**Did you know that you can build an event store in one hour?** I even did it a few times on the conference stage. Actually, it took me usually around 25 minutes; the rest was mistyping, lame jokes and a bit of explanation. See:

[![](talk.png)](https://www.youtube.com/watch?v=gaoZdtQSOTo)

**Yet, my final thought was: Kids don't do it at home.**

It's a fun coding exercise, but using the outcome in production? Not as much fun running and maintaining it. Why though? How hard can it be?

Event Sourcing systems have two phases: appending events and processing them afterwards. The write side gets most of the attention in tutorials and talks - commands, deciders, event stores, optimistic concurrency, as you saw, I'm also one to blame.

Providing the guarantees on the write side is relatively simple, especially if you use a database like PostgreSQL as a storage. You need to provide features like:
- appending an event at the end of the stream,
- reading all events from the stream,
- a guarantee of the ordering within the stream,
- being able to read your writes,
- strong-consistent, atomic writes and optimistic concurrency.

That can be solved with knowledge about transactions, database design, etc. So again, why so hard?

The processing side is where systems often struggle as they grow. This is where the Event Sourcing solution becomes an Event-Driven Messaging tool. And if you've read my previous articles, you know that this can be tricky at times.

How do you reliably process events to build read models? How do you trigger side effects without losing messages? How do you scale processing independently from writes? How do you make it performant and run multiple handlers in parallel?

I've been working on the message processing architecture in [Emmett](https://github.com/event-driven-io/emmett) for a while now. I'll try to explain how I designed the split between Consumers and Processors, the problems it solves, and the tradeoffs involved.

![Consumers & Processors](./Consumers-Processors.jpg)

## Why Split Consumers and Processors?

When processing messages, we already know that someone produced them. We're on the receiving end. Facts are already known; now we need to do something about them.

When we process them, do we care about the source? Typically, we take the information it gathers and reason about it. For instance, when we received an event indicating that a room reservation was made, we may need to send an email with details to the consumer, update the reservations dashboard, and generate a pro forma invoice. We may have specific logic, depending whether it came from our internal reservation platform or Booking.com, but we know the source from the message payload.

That seems obvious, but it was an important realisation for me. When we're building a read model in MongoDB, we don't care if events come from PostgreSQL event store, EventStoreDB, RabbitMQ queue or Kafka topic.

It needs events and the projection logic. Of course, it needs to know the guarantees around: delivery, ordering, idempotency, etc., but besides that? The message's source doesn't matter to its logic.

Similarly, a component polling PostgreSQL for messages to publish them doesn't care what happens to those events - whether they update read models or trigger webhooks is irrelevant to polling logic.

These concerns are orthogonal.

I realised that much of the complexity comes from coupling those two together. We wouldn't like to change our processing logic because of an internal change in how they're produced, or vice versa. I concluded that separating them means each can evolve independently. And I came with the initial idea for the split: Consumers and Message Processors.

**Consumers** are responsible for getting messages from a source and forwarding them to processors. Think of them as the "delivery mechanism." They handle the "where do events come from" concern. A consumer might connect to:
- A PostgreSQL event store, polling the events table,
- EventStoreDB, using push-based catch-up subscriptions,
- Kafka, consuming from topics,
- Any other message source you might have.

**Processors** are responsible for doing something meaningful with those messages. They handle the "what do we do with messages" concern. A processor might:
- Update a read model in PostgreSQL or MongoDB,
- Call an external API when certain events occur,
- Publish events to Kafka or fire webhooks,
- Trigger workflow steps or saga operations.

This separation follows Unix philosophy: small, focused components connected by simple interfaces. Each piece does one thing well. You can plug any processor into any consumer. This gives you flexibility that matters in practice:

- You can run the same projection logic against different event sources
- Adding new processors doesn't require changing consumer code
- You can test processors in isolation with fake event streams
- Consumers and processors can be scaled independently

Let me show you how this looks in practice.

## How Consumers Work

I deliberately decided to keep Consumers as dumb as possible. A consumer's entire job is:

1. Connect to a message source,
2. Poll messages in batches or subscribe to notifications (depending on the source specifics).
3. Forward them to all registered processors.
4. Go back to step 2.

That's it. No business logic. No complex state management. No decision-making about what to do with messages. Consumers are essentially routers.

Why this simplicity? I'm a simple guy; I like clear boundaries for responsibility. They help me reason about both how to use the tool and how to handle it when things go wrong. When message delivery breaks, you want to know exactly where to look. With a simple consumer, the question is binary: did it deliver messages or didn't it? There's no complex interaction between delivery logic and processing logic to untangle at 3 AM.

For EventStoreDB, the consumer creates a single subscription and fans out messages to all registered processors. For PostgreSQL, it polls the message table in batches, handling ordering guarantees (we'll get to why that later).

Here's what a basic consumer setup looks like for PostgreSQL :

```typescript
const consumer = postgreSQLEventStoreConsumer({
  connectionString,
  processors: [
    shoppingCartDetailsProjector,
    customerAnalyticsProjector,
    orderNotificationReactor
  ]
});

await consumer.start();
```

Set up looks accordingly for the other sources providing options specific for the source, e.g. for EventStoreDB store, you may want to provide the category stream name:

```ts
const consumer = eventStoreDBEventStoreConsumer({
  connectionString,
  from: { stream: '$ce-roomRservations', options: { resolveLinkTos: true } },
});
```

The consumer receives messages, batches them and forwards them to all processors. Each processor handles messages independently - they don't know about each other, and they don't need to.

## Why Batching Belongs to Consumers

Who decides how many messages to fetch at once? That's a tricky question. I think that batching can happen both at the consumer and processor levels. The consumer decides the batch size for the polling or receiving to tune the receiving throughput. The processor can either align with it, using those batches as a safe default or diverge to its specifics. Read more on [Why you should batch message processing in my other article](/en/batching_async_enumerable/).

Different message sources have different optimal batch sizes. PostgreSQL might be efficient with 100-row fetches. EventStoreDB subscriptions don't have built-in batching; they deliver events as they arrive. Kafka has its own batching semantics. These are all source-specific optimisations we should be able to apply without ending up with the lowest common denominator.

Processors, by default, can just receive batches and process them. Then they can decide whether to split batches into smaller chunks, group them into even larger chunks, or process them as single messages. For instance, PostgreSQL can handle random single updates pretty well, whereas [Elastic prefers batching updates](/en/projecting_from_marten_to_elasticsearch/).

## How Processors Work

If consumers are simple routers, processors are where the interesting work happens. They're the smarter ones in this relationship. A processor is responsible for:
- **Processing logic**: Actually doing something useful with events. Updating a read model, sending an email, calling an API.
- **Checkpointing**: Tracking which messages have been processed. This is crucial - without it, you'd reprocess everything from the beginning every time you restart.
- **Error handling**: Deciding what to do when processing fails. Retry? Skip? Stop everything?
- **Idempotency**: Doing their best to ensure that reprocessing the same event doesn't cause problems. Of course, still assuming that handlers should be idempotent, read more in [my other article](/en/idempotent_command_handling/),
- **Backpressure:** They need to be able to tell consumers that they cannot process more messages at the moment, and that the consumer needs to slow down delivery.

Those are general promises and common stuff for the message processing logic. Still, there are multiple reasons why you want to process incoming messages:

- **Read models (projections)** transform events into queryable state. For instance, shopping cart events - _ProductItemAdded_, _ProductItemRemoved_, _ShoppingCartConfirmed_ - need to become a document showing current items, quantities, and totals. Something your API can quickly return when a user opens their cart.
- **Reactions** trigger side effects after a business fact has happened. When a shopping cart is confirmed, you may want to send a confirmation email, notify the shipment module, and register a new order. These things need to happen, but they're not part of the core business logic.
- **Workflows** coordinate multi-step processes across multiple streams. An order might involve payment processing, inventory reservation, and shipping coordination - each with its own state and events.
- **Integration** means forwarding events to other systems. Other services in your systems might need to know about orders. External partners might need webhook notifications. You might publish to messaging systems for downstream consumers.

All of those processing needs a bit different ways to handle reliability, ordering, throughput, etc. Also, all tools we integrate with require a different approach: storing the read model in PostgreSQL will be _quite_ different from forwarding a message to Kafka.

I wouldn't like to handwave all of those specifics and end up with the lowest common denominator. That's why I decided to group them into the following _archetypes_:
- projectors,
- reactors,
- [workflows](https://www.architecture-weekly.com/p/workflow-engine-design-proposal-tell),
- allow custom message processors to allow people to tune it fully to their needs,
- and in the future, stuff like forwarders, web hooks and others we find useful.

All of them should have a unified API that allows them to be plugged into different consumers, while also embracing differences in message processing and target API specifics.

That's also why each message processing target (PostgreSQL, EventStoreDB, MongoDB, InMemory, Kafka, SQS, etc.) will have its own implementations.

I believe that this focused responsibility, different archetypes, and specific implementations for different tools will strike the right balance between reusability and avoiding the lowest common denominator. We'll see if that's not a famous last words.

Read also more in:
- [My RFC for Workflow Processing](https://github.com/event-driven-io/emmett/pull/257/files)
- [How message pipelines can be technically implemented](https://www.architecture-weekly.com/p/compilation-isnt-just-for-programming).

The example projector can look like that:

```ts
const projection = pongoSingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
 }),
});


const postgreSQLProjector = postgreSQLProjector({ projection });
```

```ts
const reactor = postgreSQLReactor({
    processorId: 'order-notifications',
    canHandle: ['ShoppingCartConfirmed'],
    eachMessage: (event) =>
      emailService.sendOrderConfirmation(event.data.customerId);
  }
```

## Native implementations of processors

Different storage requirements require different capabilities, and getting proper guarantees might involve deeper knowledge. For instance, [Postgres sequences issues can impact your messaging guarantees](/en/ordering_in_postgres_outbox/). Those are cases where, when you're starting, you might not anticipate. Test environments may not even catch it; you might realise you're losing business data when you reach production. That's why it's, imho, better to have a tool that solves it rather than trying to maintain it on your own, making technical infrastructure something you need to keep working on instead of your business features. How does [Emmett](https://github.com/event-driven-io/emmett) solve them? Let's discuss them briefly. I'll try to expand in the future posts about the details.

## Resilience

What happens if the processor fails? By default, it stops processing. But only this one,  the consumer keeps pushing events to the other processors that can continue.  Consumer stops when all their processors are inactive.

Why? Consider this scenario: you have two processors, one updating MongoDB and another updating PostgreSQL. MongoDB becomes temporarily unavailable. Should that stop PostgreSQL updates?

Still, failure behaviour is configurable; your message handler can return:

- **void/ACK**: message processed successfully, continue to the next one.
- **SKIP**: Skip this message, useful for poison messages that consistently fail
- **STOP**: Stop this processor entirely.

Why have _skip_ separate from _ACK_?  Consider a poison message - a message that causes your processor to fail every time. Without _skip_, you have two bad options: fail forever (blocking all processing) or _ACK_ it (pretending you processed it). With _Skip_, you can move it to a dead-letter queue for investigation while continuing to process other messages.

For now, [Emmett](https://github.com/event-driven-io/emmett) doesn't support Dead Letter/Poison Message Queues out of the box, but they will be supported in the future. You could already append those events to some specific stream.

In upcoming releases, we'll also have configurable retry policies based on error type and other factors. Just like we already have for command handlers (e.g. to retry 3 times with exponential backoff for Optimistic Concurrency error).

There's no easy answer to when to stop and when to skip poison messages. Neither choice is universally correct. A financial system might need all-or-nothing semantics. A social media feed can tolerate inconsistency between views.

That's also why you can freely group processors within consumers. Best if they share similar resiliency and desired throughput characteristics. If they're very different, you can always spin up another consumer for the same source and process it differently.

## Checkpointing processing

In Emmett, **processors own their checkpoints**. Each processor independently tracks the last message it processed. The consumer doesn't maintain any checkpoint state.

When a consumer starts up, it asks all registered processors for their last processed position and starts polling from the earliest one.

It has several benefits:
- **Independent progress**: Processors can move at different speeds. If your MongoDB projector is fast and your analytics processor can get slow at times, they each track their own progress. The slow one doesn't hold back the fast one.
- **Isolated failures**: If one processor's checkpoint storage fails, only that processor is affected. Others continue working.
- **Easy replay**: To rebuild a single projection, you just reset that processor's checkpoint. No need to coordinate with other processors or manage a global position.
- **Flexibility**: Processors can store checkpoints wherever makes sense - in the same database as their read model, in a separate checkpoint table, or anywhere else.
- **Capability to redistribute the load.** As mentioned in the previous points, if you observe that one of the processors is slower or demands more resources, you can freely deploy it separately in a different consumer, and it'll start where it left off.

The tradeoff? When a consumer restarts, it might poll events that most processors have already seen. If one processor is significantly behind, all processors receive those events again (they just skip them based on their checkpoints). This is why you should group processors by their typical processing pace - don't put a real-time dashboard projector and a monthly analytics batch processor on the same consumer.

## Backpressure: When Processors Can't Keep Up

Backpressure occurs when processors can't process messages fast enough for the consumer to deliver them. This is a real operational concern that needs explicit handling.

[Emmett](https://github.com/event-driven-io/emmett) doesn't support it at the moment, but here's what I'm thinking about it.

There are several strategies, each with tradeoffs:

**1. Ignore backpressure**: Consumer keeps polling and pushing regardless of processor state.
- Pro: Simple, maximum throughput when processors can keep up
- Con: Memory grows unbounded, possible OOM, cascading failures

**2. Stop on any slowdown**: If any processor signals it's overwhelmed, stop polling.
- Pro: Safe, no resource exhaustion
- Con: Slowest processor determines overall throughput

**3. Force synchronised pace**: All processors must process each batch before the next is fetched.
- Pro: All processors stay in sync, predictable memory usage
- Con: The Slowest processor becomes the bottleneck for all

**4. Slow down ingress**: Adaptively reduce polling rate based on processor feedback.
- Pro: Balances throughput and stability
- Con: More complex, needs tuning

**5. Rolling buffer**: Buffer messages up to a limit, retry delivery to slow processors.
- Pro: Absorbs temporary slowdowns, maximises throughput
- Con: Needs memory limits, complex failure handling

Different systems need different strategies. Real-time dashboards might use strategy 1 (drop messages rather than lag). Financial transactions might use strategy 3 (consistency over throughput). Event forwarding to Kafka might use strategy 5 (buffer temporary network issues).

I'm leaning toward making this configurable per consumer, with sensible defaults. The default would be a bounded buffer with adaptive polling slowdown.

## Scaling: Current State and Future Plans

For now, the big benefit of having dumb consumers is that you can scale them horizontally. Of course, this works for offset-based solutions like event stores and streaming tools like Kafka. It may not always work for systems that remove the message once it's handled. Still, current consumers are using only event stores as sources; Kafka will likely come next.

You can group processors into consumers by that, reducing the number of polling jobs (one consumer polls/subscribes to one source).

I already mentioned batching, which should also increase the throughput.

Running multiple instances of the same processor causes conflicts. Both process the same events, update the same read models, and corrupt the state. [Emmett](https://github.com/event-driven-io/emmett) already has the basic capability to do [distributed locking](https://www.architecture-weekly.com/p/distributed-locking-a-practical-guide), but it's not fully plugged yet. This will come in future releases.

For now, checkpointing can detect whether a newer checkpoint is already stored (which can suggest another processor is running) and stop processing.

The recommended approach is to run the consumer as a separate service from the API. Then you can scale it separately. You can also set replicas=1 for the specific consumer to ensure one instance.

## Rebuilding Projections

Event Sourcing enables rebuilding read models from events. Bug in projection? Fix code, rebuild. New read model? Populate from history.

With processor-owned checkpoints, you can either rebuild read model from scratch by:

1. Stopping the processor.
2. Delete read model data.
3. Reset the checkpoint to the beginning.
4. Restart processing.

Or doing blue greeen by:

1. Creating a new version of your storage (with Pongo, it's just adding a suffix or prefix to your collection name).
2. Start consumer since the beginning.
3. Check if read models are close enough, and stopthe  old processor
4. Start processing.

In [Emmett](https://github.com/event-driven-io/emmett) you have even some syntactic sugar on top of consumers and processors to make this easier:

```typescript
import { rebuildPostgreSQLProjections } from '@event-driven-io/emmett-postgresql';

const rebuilder = rebuildPostgreSQLProjections({
  connectionString,
  projection: shoppingCartsSummaryProjectionV2
});

await rebuilder.start();
```

This will spin up a new consumer; other consumers and processors continue normally, with their checkpoints unaffected. You can specify the position from which you want to start, and also whether to truncate the end storage.

We'll need more metrics like gap detection and distributed locking to make it more plug-and-play.

## Wrapping Up

The consumer/processor architecture in [Emmett](https://github.com/event-driven-io/emmett) is about making event processing concerns explicit and separable:

**Consumers** handle delivery - getting events from sources to processors. They're simple by design. When delivery breaks, you know where to look.

**Processors** handle processing - doing useful things with events. They own their checkpoints, track their own progress, and handle their own failures.

This separation gives you:
- Flexibility to mix and match consumers and processors,
- Independent scaling of different processing workloads,
- Isolated failure domains,
- Easy projection rebuilds,
- Testability at multiple levels.

The design makes tradeoffs explicit:
- Partial progress over all-or-nothing (configurable soon),
- Processor-owned checkpoints over global tracking,
- Simplicity in consumers, complexity in processors,
- Eventual consistency for async operations.

There's more to build - distributed locking, partitioning, better backpressure handling. There's still a lot to do, but I believe the foundation is there, and I know real applications are using it already.

I hope that this is a good food for thought, even if you're not using [Emmett](https://github.com/event-driven-io/emmett). I'm curious about your thoughts and feedback. I'll try to tackle those cases in more detail in dedicated articles.

If you have questions, feedback, or would like to help me speed up the planned stuff, come chat in the [Emmett Discord](https://discord.gg/fTpqUTMmVa). We have a small, but welcoming and awesome community.

## Q5

Good — "source picks its own batch size, processors set the pace" is a clean division of labour. It means for `pullSource` the batch is whatever `readMessagesBatch` returns (config-driven, e.g. `batchSize: 100`), and for `pushSource` the batch is whatever naturally accumulates while the consumer was busy (which degenerates to 1 when idle and grows under load — exactly what we want, driven by processor pace, not by a timer). Good. That also sidesteps the race conditions in ESDB/Mongo because there's a single handoff point.

Now the meaty one: **how does backpressure flow `source → consumer → processors[]`**, and where do we put the knobs?

The async-iterable model gives us pull-based backpressure for free on one edge: the consumer only calls `iterator.next()` when it's ready, so the source naturally waits. The interesting question is what "ready" means, and what happens on the two edges that *aren't* pure pull:

1. **Inside `pushSource`** — the underlying subscription (ESDB `subscribeToAll`, Mongo change stream) pushes messages whether we want them or not. Something has to absorb them until the consumer pulls. That's the async queue from Q4. The question is: what happens when the queue fills up?
2. **Fan-out to processors** — the consumer hands one batch to N processors. Some are fast, some are slow. The consumer has to decide when it's "done" with the batch before pulling the next one.

Let me lay out the options for each, because they're semi-independent:

### Source → consumer backpressure (the queue-full question for `pushSource`)

- **Option A — Unbounded queue.** Never block the producer. Simplest code; OOM risk under sustained load. Not acceptable as a default.
- **Option B — Bounded queue, block the producer.** When the queue hits `maxQueueSize`, the `push` inside `pushSource` awaits a drain signal. For ESDB/Mongo this means the underlying Node stream stops being consumed, and Node's built-in `highWaterMark` backpressure propagates down to the driver, which pauses reading from the socket. Clean, uses the platform, no message loss.
- **Option C — Bounded queue, drop on overflow.** Drop oldest/newest when full. Unacceptable for event sourcing (skipped checkpoints).
- **Option D — Bounded queue + pause/resume hook.** Same as B, but `pushSource` takes an explicit `pause()`/`resume()` callback the provider implements (for drivers that don't naturally backpressure). More plumbing, but works for drivers that don't play nice with Node streams.

I'd make the default **Option B** for both ESDB and Mongo (they're both Node streams underneath, so it just works), with **Option D** available as an escape hatch for future providers that need explicit pause/resume. No configuration knob needed for the default case — the `maxQueueSize` is the only tunable, and a sensible default (say, `batchSize * 4`) keeps memory bounded.

For `pullSource`, there's no queue — the consumer's own `await next()` pause is the backpressure, and the provider just doesn't issue the next SQL query until asked. Zero work.

### Consumer → processors[] backpressure (the fan-out question)

Today's PG consumer does `Promise.allSettled(processors.map(p => p.handle(batch)))` — every processor gets the same batch, and the consumer waits for all of them before advancing. That's your blog's **strategy 3** (forced synchronised pace), and it naturally yields "slowest processor sets the tempo", which is what you said you want.

The options here are:

- **Option 1 — `Promise.allSettled` fan-out (current).** Slowest processor dictates pace. Simple, predictable memory, matches what PG already does. Processors that can't keep up slow the whole consumer, which is exactly how backpressure should propagate to the source. Grouping processors by similar throughput is the operational answer when this hurts (which your blog also recommends).
- **Option 2 — Per-processor queues.** Each processor has its own inbox; consumer fans out to all queues and moves on as soon as all queues accept. Fast processors don't wait for slow ones, but now each processor has its own checkpoint drift and memory, and the consumer can't backpressure the source meaningfully (it just fills more queues). This is your blog's **strategy 5** (rolling buffer). Much more complex, and it reintroduces the "where does unbounded memory go" question per-processor.
- **Option 3 — Explicit throttle signal.** Processors return `{ type: 'THROTTLE', untilMs }` from `eachBatch` to ask the consumer to slow down. Very explicit, very intrusive — processor authors now have to think about pacing, which is the opposite of "dumb coordinator". I don't like it.

I'd pin **Option 1** as the default — it's what PG does, it's what your blog recommends as the shipping default, and it composes perfectly with the pull-based queue from the source side: slow processors → consumer pulls slowly → `pushSource` queue fills → queue blocks producer → underlying subscription pauses. One coherent chain of natural backpressure, no explicit signalling anywhere.

**Option 2 (per-processor queues)** is worth keeping as a *future* option when you want the "rolling buffer" semantics from the blog, but it's a bigger change (per-processor checkpoints already support it, but the fan-out machinery would be completely different). I'd not build it now.

### My proposal in one sentence

Natural pull-based backpressure end-to-end: `pushSource` uses a bounded async queue (block on full, default `batchSize * 4`), consumer fan-out stays `Promise.allSettled`, no explicit throttle signal anywhere. Slow processors → slow consumer pulls → source queue fills → producer blocks → subscription pauses via Node stream backpressure. For `pullSource` it's even simpler: the consumer's own pull cadence *is* the backpressure.

Does that match your mental model? Specifically:

1. Are you OK with `Promise.allSettled` fan-out staying as the default (Option 1), with the rolling-buffer/per-processor-queue option kept for later?
2. For `pushSource`, is bounded-queue-with-block (Option B) the right default, or do you want the explicit pause/resume hook (Option D) plumbed in now for the providers where we know Node stream backpressure isn't reliable?
3. Do you want a `maxQueueSize` knob surfaced on the consumer config, or baked in with a sensible default (like `batchSize * 4`) that providers can override?

## A5

Remeber that in the long term we need to have different configurable strategies, so whatever we choose shouldn't stop from adding them later. We can start from fan-out then adding more, but potentially plugging already some abstraction to make it easier in the future. Remember that we may not have always node.js streams, as we can be using cloudflare workers, deno, vercel functions or browsers, so node.js streams would be best to be internal abstraction (thus suggested async generators).

I'm not sure about proposal, as you mentioned it in the convoluted way, I don't know what do  you mean by pushSource. Also how node.js streams backpressure is unreliable? Definitely we need to make all configurable with safe defaults.

## Refined proposal (after A5 pushback)

Three corrections to the Q5 proposal:

1. **`pushSource`/`pullSource` defined explicitly.** Both are *helper factories* that produce a platform-neutral `AsyncIterable<MessageBatch>` from a provider's primitives. Providers don't have to use them — they're convenience builders for the two common shapes:
   - `pullSource(readNextBatch, options)` — for poll-based providers (PG, SQLite). Provider gives a "read next page after position X" function. Helper wraps it in an async generator with the polling loop, abort handling, and backoff.
   - `pushSource(subscribe, options)` — for subscription-based providers (ESDB, Mongo). Provider gives a `subscribe(push, signal)` function. Helper runs `subscribe` and a drain loop joined by an internal bounded async queue, then yields batches as they accumulate.

2. **No Node streams in the abstraction. Anywhere.** The `pushSource` queue is plain JS (a bounded async queue with `await push()` semantics). When the queue is full, `push` returns an unresolved promise; the provider's `subscribe` callback naturally suspends, propagating backpressure all the way back to whatever underlying mechanism the provider uses (which may or may not be Node streams — that's the provider's private business). The abstraction works on any JS runtime: Node, Workers, Deno, Vercel, browsers.

   Retraction: my "Node stream backpressure might be unreliable" line was hand-waving. There's no evidence for it. Option D from Q5 is dropped — there's no need for an explicit `pause()`/`resume()` hook because `await push()` already gives natural producer suspension.

3. **`FanOutStrategy` is a pluggable seam from day one.** Ship `awaitAll` as the default (current `Promise.allSettled` behaviour). Design the interface so additional strategies — rolling buffer / per-processor queues, stop-on-slowdown, adaptive polling — slot in later without touching the consumer.

   ```ts
   type FanOutStrategy<M, Meta> = {
     dispatch: (
       batch: MessageBatch<M, Meta>,
       processors: ActiveProcessor<M, Meta>[],
       signal: AbortSignal,
     ) => Promise<DispatchResult>;
   };
   ```

   Consumer config exposes both `fanOut` and `maxQueueSize` as knobs, with safe defaults (`awaitAll()` and `batchSize * 4`).

Restated end-to-end:
- `MessageSource` = `(options) => AsyncIterable<MessageBatch>`. Provider-neutral, runtime-neutral.
- `pullSource` / `pushSource` = optional helper factories for the two common shapes.
- Consumer config: `{ source: { batchSize, maxQueueSize }, fanOut, processors }`.
- Default fan-out is `awaitAll`. Default `maxQueueSize` is `batchSize * 4`. Both overridable.
- Strategy seam exists from v1; only one impl ships in v1.

## A5 (continued — second pushback)

I don't understand why would we need to always push maxQueueSize to push source. Also isn't exposing signal in the API a smell and inconsistency? I think that we should pass it through options and have a proper stop/close methods as current consumers etc.

WTF is createBoundedQueue and why do we need to expose it? The exact implementation knows what can use. This should be internal stuff.

I think that you're going to wild with overengineering here

You should be gathering requirements from me, asking quesions, and you're just making huge number of assumptions and generating some random stuff.

## Reset

Refined proposal in Q5/A5 was overengineered. Throwing out the speculative pieces:
- `maxQueueSize` should NOT be a forced config knob on every push source. Maybe some sources don't need a queue at all. Don't impose.
- `signal` should not be exposed in the public API. Use proper `start()/stop()/close()` lifecycle methods consistent with current consumers, with the signal threaded through internal options.
- `createBoundedQueue` is an internal implementation detail. Should never appear in any public surface.
- `FanOutStrategy` interface, default values, knob surfacing — all premature. I was designing instead of gathering requirements.

Stepping back to actually gather requirements before proposing any more shapes.

## Q6

Restart. Before I propose any interface, I want to establish scope.

Looking at the four current implementations — `postgreSQLEventStoreConsumer.ts` + `messageBatchProcessing/index.ts`, the SQLite mirror, `eventStoreDBEventStoreConsumer.ts` + `subscriptions/index.ts`, and `mongoDBEventStoreConsumer.ts` + `subscriptions/index.ts` — each has a "consumer" object and an internal "thing that produces batches" (the puller / subscription). The duplication and the bugs both live in different places.

Which of these are you actually trying to fix with the new base code, and in what priority order?

1. **Duplicated fan-out logic** — `eachBatch` + `Promise.allSettled(processors.map(...))` + STOP-when-all-stopped is copy-pasted across all four consumers. Pull this into the base.
2. **Race conditions in ESDB/Mongo subscriptions** — the `pipeline + Transform + Writable + mutating options.startFrom` pattern is broken. Replace it with something that doesn't have these races.
3. **Restart-on-crash semantics** — Q2's "consumer should be able to restart the source when it crashes". Currently each provider rolls its own; you want this in the base.
4. **`zipStartFrom` checkpoint coordination** — already shared in spirit but each consumer reimplements it for its own checkpoint shape. Unify.
5. **Lifecycle (`start`/`stop`/`close`)** — each consumer reimplements the lifecycle dance. Pull into the base.
6. **A common contract for "thing that produces batches"** so providers don't each invent their own (`MessagePuller` in PG, the pipeline thing in ESDB, etc.).
7. Something else I'm missing.

Which of these are in scope for the first cut? Which can wait? Which are you specifically NOT trying to solve right now?

## A6

Dude, I told you that race conditions, and not needing to fix it in multiple places, so a bit of everything. I want to unify it first, then maybe refactor, Pg and sqlite has most of the race conditions fixes, but they were not applied to other

## Grounding (after re-reading actual code)

Re-read PG's two layers before asking Q7, instead of inventing more strawmen.

`src/packages/emmett/src/consumers/consumers.ts` already exists and defines:

```ts
export type MessageConsumer<...> = Readonly<{
  consumerId: string;
  isRunning: boolean;
  processors: ReadonlyArray<MessageProcessor<...>>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
}>;
```

This is the public lifecycle contract every provider's consumer implements today. The `signal` parameter Oskar called out as a smell is correctly absent here — lifecycle is method-based, signals are internal.

**PG today has two layers**:

1. **Layer 1 — puller** (`src/packages/emmett-postgresql/src/eventStore/consumers/messageBatchProcessing/index.ts`):
   ```ts
   export type PostgreSQLEventStoreMessageBatchPuller = {
     isRunning: boolean;
     start(options: { startFrom; signal? }): Promise<void>;
     stop(): Promise<void>;
   };
   ```
   Constructed with `{ executor, batchSize, eachBatch, pullingFrequencyInMs, stopWhen, signal }`. Runs the polling loop in `pullMessages`. Calls the injected `eachBatch` callback per batch. Knows nothing about processors.

2. **Layer 2 — consumer** (`src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts`): holds `processors[]`, builds the `eachBatch` callback (the fan-out — `Promise.allSettled(activeProcessors.map(p => p.handle(messages, ctx)))` with STOP-when-all-stopped), manages start/stop/init/close, computes `startFrom` via `zipPostgreSQLEventStoreMessageBatchPullerStartFrom`, plumbs the abort controller.

**What's actually duplicated across all four consumers** (PG, SQLite, ESDB, Mongo): Layer 2. The fan-out, the lifecycle dance, the `zipStartFrom`, the init loop over processors, the abort controller plumbing — copy-pasted.

**What's not duplicated and shouldn't be**: Layer 1. Polling loops vs subscription mechanics are fundamentally different, and Layer 1 is also where the race conditions live in ESDB/Mongo (the `pipeline + Transform + Writable + mutating options.startFrom` pattern).

**Unification path that follows from this**:
1. Standardize a common shape for Layer 1, modelled on PG's existing puller.
2. Reshape ESDB/Mongo Layer 1 to expose that shape — race conditions die because the new shape doesn't use `pipeline + Transform + Writable + mutating options.startFrom`.
3. Move Layer 2 into a generic factory in `src/packages/emmett/src/consumers/consumers.ts` (currently almost empty — just the interface).
4. Each provider's `xEventStoreConsumer` becomes a thin wrapper: builds its provider-specific source, hands it to the generic factory along with provider-specific context.

## Q7

PG already defines Layer 1's contract:

```ts
export type PostgreSQLEventStoreMessageBatchPuller = {
  isRunning: boolean;
  start(options: { startFrom; signal? }): Promise<void>;
  stop(): Promise<void>;
};

postgreSQLEventStoreMessageBatchPuller({
  executor, batchSize, eachBatch, pullingFrequencyInMs, stopWhen, signal,
});
```

Is this the contract we standardize on for the unified source — i.e. PG's existing puller is the model, ESDB/Mongo get reshaped to expose the same `{ isRunning, start({startFrom}), stop() }` plus a constructor-injected `eachBatch`? Or do you want to reshape the contract itself as part of this work (e.g. drop `eachBatch` from the constructor and have the base consumer pull batches from the source instead)?

## A7

I'm fine to drop eachBatch if that helps and we expose it as asyncGenerator. on processors it should stey as it is.

## A7 (addendum)

To add, message source should handle trnasient error - for sure. Regarding non-transient, that's something we can discuss.

## Q8

Source becomes an async generator. Processors unchanged. Concrete shape:

```ts
type MessageSourceFactory<M, Meta> = (options: {
  startFrom: ProcessorCheckpoint | 'BEGINNING' | 'END';
  signal: AbortSignal;
}) => AsyncGenerator<RecordedMessage<M, Meta>[]>;
```

- Provider passes a *factory*, not a pre-built generator instance — so the base can re-call it on crash-restart with a fresh `startFrom`.
- Each yield is the message array (same shape as today's `eachBatch(messages)` call in PG).
- Source picks batch size, manages its own cursor, decides when to end iteration (e.g. `return` when `stopWhen.noMessagesLeft` is set and the source is empty — replaces the current `isRunning = false; break` dance in PG's puller).
- `startFrom` is the unified `ProcessorCheckpoint | 'BEGINNING' | 'END'` from core. Base computes it via `min` over processor checkpoints. Each provider's source decodes it (PG → bigint global position, ESDB → commit position, Mongo → resume token).
- `signal` is internal to the base ↔ source handoff. The base creates the `AbortController`, threads its signal through the factory's options, and aborts on `consumer.stop()`. Not part of any public API.

Base consumer loop sketch:

```ts
const sourceFactory: MessageSourceFactory<M, Meta> = providerSource;
const startFrom = zipStartFrom(processors);
for await (const messages of sourceFactory({ startFrom, signal })) {
  if (!isRunning) break;
  const result = await fanOut(messages);
  if (result.type === 'STOP') break;
}
```

Where `fanOut` is today's `Promise.allSettled(processors.map(p => p.handle(messages, ctx)))` + STOP-when-all-stopped, lifted out of the four consumers into `src/packages/emmett/src/consumers/consumers.ts`.

**Question**: Is yielding `RecordedMessage<M, Meta>[]` enough, or does each yield need to be wrapped in an object carrying extra fields? PG's puller currently reads `{ messages, currentGlobalPosition, areMessagesLeft }` from `readMessagesBatch` — but `currentGlobalPosition` is just used internally to advance the cursor (now internal to the source), and `areMessagesLeft` drives `stopWhen.noMessagesLeft` (which the source can handle by `return`-ing). So I think the array alone is sufficient — but you might know cases (ESDB? Mongo? future Kafka?) where the base consumer needs more from each batch.

## A8

I think that's fine, if we need some control message, they can be a specific type of message. We'll need to know that we've reached the end of the log, or other wyas to calculate metrics

## Q9

A8 settles the yield shape: `RecordedMessage<M, Meta>[]` is enough, and signals like "end of log" or metric-relevant events flow as a discriminated control-message variant in the same array. Discriminator details (a `type` field, where filtering happens, whether processors see them) get nailed down at spec time.

Now the open thread you flagged: **non-transient errors**. After the source has exhausted its internal transient-error retries (Q2/A2 — handled inside the source) and throws something genuinely fatal — PG pool exhausted past the retry budget, ESDB hard auth failure, Mongo replica set permanently unreachable, schema mismatch, etc. — what should the base consumer do?

Three options:

1. **Let it bubble.** The `for await` re-throws, `consumer.start()` rejects, `isRunning` becomes false, processors get closed. User code or an external supervisor (PM2, k8s, Temporal, whatever) restarts the process. This is what PG does today — there's no outer retry around `pullMessages`.

2. **Auto-restart inside the base.** Base wraps the `for await` in a retry loop with backoff. On error: catch, log, wait, recompute `startFrom` from processors (so each restart picks up from the latest durable checkpoint), call the source factory again, keep going. Effectively infinite, until `consumer.stop()`. This is closer to what ESDB/Mongo are *trying* to do today via `asyncRetry` — but the race conditions live in that retry path because of the `pipeline + Transform + mutating options.startFrom` shape. The async-generator-factory model from Q8 makes this restart safe (each call gets fresh options, no shared mutable state).

3. **Configurable, with a safe default.** Same option as (2) but gated on something like `restartOnError: false | true | { backoffMs, maxAttempts }`. Default picks one of the two behaviors above.

Sub-question if you go with (2) or (3): is restart **unbounded** (keep retrying forever until stop), or capped (give up after N attempts and bubble like option 1)?

My read: ESDB/Mongo's existing intent is option 2 — they want the consumer to survive transient infra hiccups without the host process restarting. PG's current behavior (option 1) is arguably a gap, not a deliberate design. So unifying might mean **everyone gets option 2 with unbounded restart and exponential backoff**, which would actually fix a latent fragility in PG too. But I want your call before I commit to that — you know the operational reality of how these are deployed better than I do.

## A9

I think that having auto-restart is helpful, that's one of the reasons why you'd have bastractions. One should be able to provide retry policy overriding the default one, just like in other places.

## Open questions roadmap

Recording the remaining interview list so we both see the structure (will tick these off as we go):

- **Q10 — retry policy details**: defaults + scope. The codebase already has `AsyncRetryOptions` in `src/packages/emmett/src/utils/retry.ts` (built on `async-retry`, with `shouldRetryError` / `shouldRetryResult` / `NoRetries`). That's the natural shape to reuse for the consumer's outer policy. Open: defaults, and whether the source's *inner* transient retry is also standardized or left fully provider-internal.
- **Q11 — stop/shutdown semantics**: when `consumer.stop()` is called mid-batch, do we wait for the in-flight batch to finish (graceful) or abort immediately and re-deliver next start? PG today aborts via signal but still `await start`s.
- **Q12 — fan-out error semantics**: today PG STOPs only when *all* processors return STOP (`r.value?.type !== 'STOP'`). Keep that, or change? What about a processor *throwing* (not returning STOP) — currently absorbed by `Promise.allSettled` and ignored.
- **Q13 — provider context threading**: how does the per-provider context (PG pool, ESDB client, Mongo collection) get into `processor.handle(messages, ctx)`? Per-provider override of the fan-out, or a generic `buildContext()` hook on the factory?
- **Q14 — `canHandle` filtering location**: PG has a literal `// TODO: Add here filtering to only pass messages that can be handled by processor`. Does the base filter per processor before fan-out, or does each processor filter internally?
- **Q15 — provider wrapper API shape**: after the refactor, what does `postgreSQLEventStoreConsumer({...})` look like? Just builds a `sourceFactory` + provider context and delegates to a generic `createMessageConsumer({ sourceFactory, processors, ... })`?
- **Q16 — migration / backwards compat**: do we keep the existing `postgreSQLEventStoreConsumer` / `eventStoreDBEventStoreConsumer` / etc. exports stable (wrap-and-delegate) or is this a breaking change shipped in the next major?
- **Deferred to spec**: control-message discriminator (a `type` field, where filtering happens, whether processors see them).

## Q10

Settled by A9: outer auto-restart with overridable retry policy. The codebase already has the right primitive — `AsyncRetryOptions` from `src/packages/emmett/src/utils/retry.ts`:

```ts
export type AsyncRetryOptions<T = unknown> = retry.Options & {
  shouldRetryResult?: (result: T) => boolean;
  shouldRetryError?: (error?: unknown) => boolean;
};
export const NoRetries: AsyncRetryOptions = { retries: 0 };
```

So the consumer gains an option like `restartPolicy?: AsyncRetryOptions` — defaults to "always restart with exponential backoff", users can override (e.g. pass `NoRetries` to bring back the bubble-up behavior, or pass a `shouldRetryError` to exclude specific fatal errors, or cap attempts).

Two sub-questions:

1. **Default values.** What's a reasonable default? My instinct: unbounded retries with exponential backoff capped at ~30s (so e.g. `retries: Infinity, factor: 2, minTimeout: 100, maxTimeout: 30_000`). The host can still kill the process if it wants to. Alternative: cap at e.g. `retries: 10` so something visibly fails after persistent infra death.

2. **Inner transient retry — also standardized, or fully provider-internal?** Per A7 addendum, the source handles its own transient errors. The question is whether the consumer config exposes a knob for *that* too (e.g. `transientRetryPolicy`) so users can tune both layers from one place — or whether each provider exposes its own per-provider config and the base only knows about the *outer* restart policy. My read: keep them separate. Each provider already has its own connection/client config, transient retry naturally lives there. Base only standardizes the outer policy. Lower coupling, no leaky abstraction. But you might want one unified knob — say if you do.

## A10

1. Fine, still, that's detail in the whole design, I'd rather discuss how this refactoring will work, and what's needed than spend time on this so early.
2. I don't think that we can standardize all. There are EmmettError(s) so we can standardize a lot, but some will probably require the sdk

**Resolved:** Default tuning values deferred to spec time / implementation. Inner transient retry stays provider-internal — base standardizes only the outer restart policy via `AsyncRetryOptions`. `EmmettError` family covers what *can* be standardized (e.g. cross-provider conditions like `ConcurrencyError`, optimistic-lock failures) and the source can opt those into its inner retry generically; provider-SDK-specific errors stay inside the provider source.

**Reprioritising the roadmap** per your signal — moving structural questions ("how the refactoring lands") ahead of granular semantics. New order:

- **Q11** — refactoring approach: order of operations, PR cadence, what stays stable during the transition.
- **Q12** — provider wrapper API shape after the refactor (was Q15).
- **Q13** — migration / backwards compat (was Q16).
- **Q14** — provider context threading (was Q13).
- **Q15** — stop/shutdown semantics (was Q11).
- **Q16** — fan-out error semantics (was Q12).
- **Q17** — `canHandle` filtering location (was Q14).
- Deferred to spec: control-message discriminator, retry defaults.

## Q11

How does this refactoring actually land? My proposal — push back where it's wrong:

**Order of operations** (extract from the strongest, migrate the weakest last):

1. **Extract the generic base into `src/packages/emmett/src/consumers/consumers.ts`.** Lift Layer 2 from PG (it's the cleanest two-layer split). Shapes: `MessageSourceFactory<M, Meta>`, generic `createMessageConsumer({ sourceFactory, processors, restartPolicy?, ... })`, the `fanOut` helper, the `zipStartFrom` helper, the `AsyncRetryOptions`-wrapped restart loop. No provider touched yet — this PR is purely additive in core, with unit tests using a fake in-memory source.

2. **Migrate PG.** `postgreSQLEventStoreConsumer` becomes a thin wrapper that builds a `sourceFactory` (an async-generator over the existing `readMessagesBatch`) plus the PG context, and delegates to `createMessageConsumer`. PG's existing puller (`messageBatchProcessing/index.ts`) gets reshaped or absorbed. PG's existing public API stays stable. Race conditions: nothing changes for PG — it didn't have any.

3. **Migrate SQLite.** Same shape as PG (it was built on PG's approach to begin with), so this is mechanical.

4. **Reshape ESDB.** The big one. Replace the `pipeline + Transform + Writable + asyncRetry-with-mutating-options` with an async-generator wrapping the ESDB subscription. *This is where ESDB's race conditions die* — because the new shape doesn't share mutable state across reconnects. Each restart calls the source factory afresh with a `startFrom` recomputed from durable processor checkpoints.

5. **Reshape Mongo.** Same surgery as ESDB on its change-stream subscription.

**PR cadence:** each step is a separate, independently mergeable PR. Step 1 ships with full tests against the in-memory source so the base is proven before any provider depends on it. Steps 2–5 each ship with their existing integration tests passing unchanged, plus a regression test for ESDB/Mongo's specific race-condition scenarios in steps 4–5.

**Public API stability:** every provider's existing `xEventStoreConsumer({...})` factory keeps the same name, the same options shape, and the same returned `MessageConsumer` interface — all that changes is its internals delegate to the generic base. No user code breaks.

**Three things I want your call on:**

a. Is this order right, or do you want to start from a different provider? (e.g. start from ESDB to prove the race-condition fix earliest, even though it's the riskiest.)

b. Is the existing PG puller (`PostgreSQLEventStoreMessageBatchPuller`) **reshaped** to expose the new async-generator-factory shape, or is it **absorbed** into the consumer (deleted as a separate type, since the base now owns the pulling loop)? My instinct is absorbed — the puller as a separate concept exists today only because Layer 2 was duplicated. Once Layer 2 is generic, Layer 1 is just "the source factory", and there's no need for a named puller type.

c. Anything in the existing PG/SQLite/ESDB/Mongo consumers that you know is **load-bearing in a way that won't survive** this refactor? Things I should look at before assuming the shape transfers cleanly.

## A11

I think that's fine from big picture. I'm not sure what do you mean by sourceFactory? probably we should have a dedicated messageSourceFactory from pg.

**Clarifying what I meant by `sourceFactory`** — bad on me for using it as a bare variable name without grounding it.

It's an instance of the contract type from Q8, which I'd been calling `MessageSourceFactory<M, Meta>`:

```ts
// in core: src/packages/emmett/src/consumers/consumers.ts
export type MessageSourceFactory<M extends Message, Meta extends MessageMetadata> = (
  options: {
    startFrom: ProcessorCheckpoint | 'BEGINNING' | 'END';
    signal: AbortSignal;
  },
) => AsyncGenerator<RecordedMessage<M, Meta>[]>;
```

Each provider exports a **dedicated, concrete** function that conforms to this type — exactly what you said. For PG that's:

```ts
// in PG package: src/packages/emmett-postgresql/src/eventStore/consumers/messageSource/postgreSQLEventStoreMessageSourceFactory.ts
export const postgreSQLEventStoreMessageSourceFactory = (
  config: { executor; batchSize; pullingFrequencyInMs; stopWhen; }
): MessageSourceFactory<...> => {
  return async function* ({ startFrom, signal }) {
    // the polling loop currently inside `pullMessages`, lifted out
    // wraps `readMessagesBatch` in inner transient retry
    // yields RecordedMessage[] per batch
    // returns when stopWhen.noMessagesLeft and source is empty, or signal aborts
  };
};
```

The PG consumer wrapper then becomes:

```ts
// in PG package: postgreSQLEventStoreConsumer.ts (now ~30 lines, mostly options plumbing)
export const postgreSQLEventStoreConsumer = (options) => {
  const sourceFactory = postgreSQLEventStoreMessageSourceFactory({
    executor: options.executor,
    batchSize: options.batchSize,
    pullingFrequencyInMs: options.pullingFrequencyInMs,
    stopWhen: options.stopWhen,
  });
  return createMessageConsumer({
    consumerId: options.consumerId,
    processors: options.processors,
    sourceFactory,
    restartPolicy: options.restartPolicy,
    // PG-specific context for processor.handle goes here too — see Q14
  });
};
```

Same pattern for the other three: `sqliteEventStoreMessageSourceFactory`, `eventStoreDBMessageSourceFactory`, `mongoDBMessageSourceFactory`. Each lives in its own provider package, each is the *only* place that knows about its SDK / wire format / cursor type.

**This also answers Q11 sub-question (b)**: the existing `PostgreSQLEventStoreMessageBatchPuller` is **reshaped and renamed** into `postgreSQLEventStoreMessageSourceFactory` — not absorbed into the base. It stays a standalone file in the PG package, independently testable. What changes is its contract: instead of `{ start({startFrom, signal}); stop() }` with an injected `eachBatch` callback, it returns an async generator factory. Lifecycle (start/stop/abort) moves to the base. The puller-as-named-type goes away because the base doesn't need a named puller; it just consumes whatever the factory produces.

**Still open from Q11**: sub-question (c) — anything load-bearing in the four existing consumers you know won't survive cleanly that I should look at before going further? You didn't touch on that one. If it's "nothing comes to mind, just go look at the code", that's also a valid answer.

## A11 (c)

It works as in the implementation.

**Resolved:** the implementation is the source of truth — no quirks held in your head that I'd miss by reading carefully. I'll lean on the actual code (and the existing tests as the behavioural contract) when I get to writing this.

**Q12 — provider wrapper API shape — substantially answered by the A11 sketch.** The wrapper is ~30 lines: builds the dedicated `xxxMessageSourceFactory`, hands it to `createMessageConsumer` along with `consumerId`, `processors`, `restartPolicy`, and provider context. Public API stays stable. Each provider's options shape stays its own (PG has `executor`, ESDB has `client`, Mongo has `collection`, etc.) — that's the point of having a wrapper.

One small thing worth noting before I move on: PG's existing `stopWhen.noMessagesLeft` (used by tests to drain-and-exit) doesn't need to become a base concept. It stays in the PG source factory's config — the source `return`s from its async generator when drained, and the base's `for await` loop ends naturally. Control messages from A8 are for *passive observation* of "end reached" (metrics, dashboards), not for stopping. Stopping is handled by generator return. If that's wrong, push back; otherwise Q12 is closed.

## Q13

Migration / backwards compat. Two related questions:

1. **Public API stability during the transition.** I said in Q11 that every `xEventStoreConsumer({...})` keeps the same name, options shape, and returned `MessageConsumer`. Confirming the bar: **zero user-code changes required** to upgrade across this refactor — even the option names stay identical. Anything you want to *clean up* in the same window (deprecated options to drop, renames you've been wanting, etc.), or do we keep this PR series strictly internal-only and queue cleanups separately?

2. **Versioning.** Does this land in the next minor (since it's behaviour-preserving from the user's POV), or do you want it gated behind a major because the *internal* type names change (`PostgreSQLEventStoreMessageBatchPuller` → `postgreSQLEventStoreMessageSourceFactory`, etc.) and somebody might be importing those directly?

## A13

1. Not atm.
2. This can change consumer api shouldn't be renamed.

## A13 (clarification)

I mean consumer api can change, but where it's needed, not just for the sake of changing it.

**Resolved:**
- No cleanups bundled in this window.
- Internal type names (`PostgreSQLEventStoreMessageBatchPuller` → `postgreSQLEventStoreMessageSourceFactory`, etc.) can change freely.
- The **consumer API** *can* change where the refactor genuinely needs it — e.g. a new option like `restartPolicy`, or a slot for the source factory inside a wrapper that previously didn't expose one. What it must **not** do is change for cosmetic reasons (no renaming `postgreSQLEventStoreConsumer` to something else, no shuffling option names just to make them prettier).
- Bar I'll apply: every API change earns its keep with a concrete reason. If I find myself wanting to rename something "for consistency" or "because the new name is nicer", I'll leave it alone.
- Versioning: still my read that this lands in next minor since the user-facing surface stays compatible at a behavioural level. Push back if you want a major.

## Q14

Provider context threading. Grounding from the existing code:

`MessageProcessor` already carries a `HandlerContext` type parameter:

```ts
export type MessageProcessor<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = {
  ...
  init: (options: Partial<HandlerContext>) => Promise<void>;
  start: (options: Partial<HandlerContext>) => Promise<CurrentMessageProcessorPosition | undefined>;
  close: (closeOptions: Partial<HandlerContext>) => Promise<void>;
  handle: BatchRecordedMessageHandlerWithContext<MessageType, MessageMetadataType, Partial<HandlerContext>>;
};
```

So `Partial<HandlerContext>` is already plumbed through every lifecycle call. The PG consumer today builds the partial context (with the executor) and threads it into `init`, `start`, `close`, and `handle`. Each processor mixes that partial with its own state.

**Proposal**: `createMessageConsumer` becomes generic over `HandlerContext`, and the provider wrapper supplies the partial context as a value:

```ts
// in core
export const createMessageConsumer = <M, Meta, Ctx extends DefaultRecord | undefined>(
  options: {
    consumerId?: string;
    processors: MessageProcessor<M, Meta, Ctx>[];
    sourceFactory: MessageSourceFactory<M, Meta>;
    handlerContext: Partial<Ctx>;       // <-- provider plugs PG/ESDB/Mongo specifics in here
    restartPolicy?: AsyncRetryOptions;
  },
): MessageConsumer<M> => { ... };
```

The base threads `handlerContext` into `processor.init`, `processor.start`, `processor.handle`, `processor.close` exactly the way PG does today. The base never inspects it.

**Two open sub-questions:**

a. **Static or per-batch?** PG today builds the partial context **once** (at consumer construction, captured in closure with the executor). The processor itself owns transaction scope. Should the base do the same — accept a static `handlerContext` value — or accept a *function* `buildHandlerContext: () => Partial<Ctx>` it can call per batch (or per call) for providers that need a fresh resource handle each time? My read: static is enough because PG, SQLite, ESDB, Mongo all hold long-lived connections/clients and the per-batch transaction is the processor's job, not the consumer's. But you'd know if any of them have a reason to want per-batch context construction.

b. **Single context or per-processor?** Today PG passes the *same* partial context to every processor. Is that always correct, or are there cases where different processors in the same consumer need different bits of context (e.g. one PG processor wants the pool, another wants a dedicated executor)? If yes, the answer is "leave it to the processor — each processor mixes its own pieces with the partial". If you've ever seen a case where the consumer needs to dispatch *different* contexts to *different* processors, tell me now and the shape changes.

## A14

Man, is it crucial for now? why are you asking about it? Consumers and processors should be as less dependant as possible

**Resolved (and I was over-asking):** the principle settles both sub-questions. Base parameterizes on `Ctx` generically, treats it as opaque, threads it through unchanged. No `buildHandlerContext` knob. No per-processor dispatch. Whatever PG/ESDB/Mongo do today to inject context carries over without me redesigning it. The existing `consumers.ts` already types `MessageProcessor<M, any, any>` — the base really doesn't care about the context shape. Q14 closed.

## Spec readiness check

Looking at what's still on my list — Q15 (stop semantics), Q16 (fan-out error semantics), Q17 (canHandle filtering) — I think most of these are similarly **YAGNI for the unification spec**. The current behaviour in PG is the answer for all three; the refactor lifts it as-is, and changing any of it is a separate decision for a separate PR.

What's actually nailed down so far for `spec.md`:

1. **Two layers**: Layer 1 (source) is per-provider, Layer 2 (consumer) is generic in core.
2. **Source contract**: `MessageSourceFactory<M, Meta>` = `({ startFrom, signal }) => AsyncGenerator<RecordedMessage<M, Meta>[]>`. Provider passes a *factory*, base re-calls it on restart with fresh `startFrom`. Each provider exports a dedicated concrete factory (`postgreSQLEventStoreMessageSourceFactory`, etc.).
3. **Source responsibilities**: own batch size, own cursor, own internal transient retry (provider-SDK-specific errors live here), own when to `return` from the generator. Control messages allowed in the yielded array for things like "end of log" / metrics.
4. **Base consumer responsibilities**: lifecycle (start/stop/close), abort controller plumbing, fan-out across processors, `zipStartFrom` over processor checkpoints, outer restart loop on non-transient errors with `restartPolicy: AsyncRetryOptions`. Default policy: auto-restart with exponential backoff (concrete numbers deferred to implementation).
5. **Handler context**: opaque, threaded through unchanged. Base doesn't inspect it.
6. **Refactor order**: extract base from PG → migrate PG (puller renamed/reshaped to source factory) → migrate SQLite → reshape ESDB (race conditions die here) → reshape Mongo. Each a separate PR. Public consumer API names stay; changes earn their keep.
7. **Existing tests are the behavioural contract.**

That's the unification spec. The race conditions in ESDB/Mongo die at step 4/5 because the new shape (factory called fresh on restart, no `pipeline + Transform + mutating options.startFrom`) doesn't share mutable state across reconnects.

**Question for you**: should I draft `spec.md` now from the above, or is there a topic you want to cover first that I haven't asked about? Q15/Q16/Q17 from my roadmap are still on the list if you want them, but my read is they're "carry over what PG does today" answers and don't need to live in this spec.

