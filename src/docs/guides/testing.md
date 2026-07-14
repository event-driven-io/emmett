---
documentationType: how-to-guide
outline: deep
---

# Testing {#testing}

**Tests are first-class citizens in Emmett.** Once your business logic is a set of functions returning events, testing turns into a repeatable pattern you can apply from a single decision up to the whole running API. This guide shows you how, at three levels: the business logic on its own, the HTTP API against an in-memory store, and the whole slice end-to-end against a real database. Read models get their own section too.

No matter which level you pick, the shape stays the same:

::: tip

- **GIVEN** the events already recorded,
- **WHEN** you run a command or a request,
- **THEN** you assert the new events, or the error.

:::

The helpers change; the pattern doesn't. For the thinking behind it, read [Behaviour-Driven Design is more than tests](https://event-driven.io/en/behaviour_driven_design_is_not_about_tests/).

## Test Business Logic {#business-logic}

**Business logic is where your rules live**, and in Emmett it's a plain function: `decide` takes the current state and a command, and returns events. No I/O, no framework, nothing to mock. That makes it the cheapest thing to test, so this is where most of your tests belong. Set up a `DeciderSpecification` once with your `decide`, `evolve`, and `initialState`:

<<< @/snippets/gettingStarted/businessLogic.unit.spec.ts#unit-spec

For each command, three questions cover it: does it produce the right events when the rule allows the action, does it say no when the rule forbids it, and does it stay quiet when there's nothing to do? That's three tests, each named after the rule it guards.

### Assert the events it produces {#assert-events}

Give it a state through the `given` events, run the command, and check what comes back. Assert the events, not the state the decision saw. The events are what the rest of your system reacts to; the state is just how the decision got there.

<<< @/snippets/gettingStarted/businessLogic.unit.spec.ts#unit-events

### Assert the rule it enforces {#assert-error}

A rule isn't proven until you show it saying no. Set up a state that should reject the command, then assert the exact error, not merely that something threw. That same error becomes the caller's `403` later, so it's worth pinning down. `thenThrows` takes the error type, a check on the message, or both:

<<< @/snippets/gettingStarted/businessLogic.unit.spec.ts#unit-error

### Assert it stays quiet {#assert-noop}

Some commands are valid but have nothing to add, like removing an item that's already gone. Returning no events for those is what keeps a command safe to send twice. Assert that path with `thenNothingHappened()`.

## Test the API In-Memory {#api-in-memory}

**A lot happens between the request and the decision.** The request gets mapped to a command, validated, run through middleware, and its result turned into a status code. None of that is visible to a unit test, so let's cover it, still in memory, so the tests stay fast enough to run continuously.

`ApiSpecification` gives you the same given/when/then, this time over HTTP. Point it at the seams the unit tests can't reach, and leave the rule-by-rule coverage to them.

### Set up the specification {#api-setup}

Inject the in-memory store and stub what the slice reaches for (the price lookup and the clock), so the results are deterministic:

<<< @/snippets/gettingStarted/webApi/apiBDDIntGiven.ts#given

### Assert the response and the new events {#api-assert}

`existingStream` seeds the stream, `when` sends the request, and `then` checks both sides of the outcome at once: the status the caller gets, and the events that land in the store.

<<< @/snippets/gettingStarted/webApi/apiBDDIntTest.ts#test

### Assert the failure the caller sees {#api-error}

The unit test already showed the rule throws. Here you show the throw turning into the right HTTP contract: `getApplication` maps `IllegalStateError` to a `403` with a [Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html) body. Assert it with `expectError`:

<<< @/snippets/gettingStarted/webApi/apiBDD.int.spec.ts#int-error

## Test End-to-End Against PostgreSQL {#e2e}

**In-memory is great for a fast loop, but it never touches a real database.** Serialisation and queries only run for real against the actual store, and that's exactly where surprises hide. So keep a small end-to-end set for the flows that matter most, and treat the API as a black box.

### Start a database container {#e2e-container}

Spin up PostgreSQL in a throwaway container with [TestContainers](https://node.testcontainers.org/), which randomises the port and cleans up after itself. Start one for the whole suite and reuse it, since the store keeps a connection pool, then close both in `afterAll`:

<<< @/snippets/gettingStarted/webApi/apiBDDE2EGiven.ts#test-container

### Point the specification at it {#e2e-spec}

It's the same `getApplication` as before, now backed by the container's store. That's the nice part: you're re-running a known slice against real infrastructure, not writing it twice.

<<< @/snippets/gettingStarted/webApi/apiBDDE2EGiven.ts#given

### Drive it through HTTP {#e2e-test}

Setup runs through requests too, so you assert only the responses. Here we open a cart with a product, then confirm it:

<<< @/snippets/gettingStarted/webApi/apiBDDE2ETest.ts#test

## Test Projections {#projections}

**Projections earn their keep in a real database**, so that's the only honest place to test them. Serialisation and querying are the whole point, and an in-memory fake would paper over both. Assert the stored document as the read model evolves: the first event creates it, later events add to it, and a terminal event clears it. `PostgreSQLProjectionSpec` keeps the same given/when/then, this time over Pongo documents:

<<< ./projections/testingProjections.snippet.ts#testing-projection

The same spec ships for every store: swap `PostgreSQLProjectionSpec` for `SQLiteProjectionSpec`, `MongoDBInlineProjectionSpec`, or `InMemoryProjectionSpec` (no container, so it runs at unit speed). The given/when/then doesn't change.

### Assert it handles duplicates {#projection-idempotent}

Emmett processes each event exactly once today: inline projections run inside the append transaction, async ones through transactional checkpointing. Even so, keeping a projection idempotent is worth it. Emmett may later add consumers, such as ones backed by Kafka, RabbitMQ, or SQS, that deliver an event more than once, and a projection that double-counts on the second pass would be a latent bug. Replay the same events with `{ numberOfTimes }` to prove yours holds. Here a discount guarded by its coupon id is handled twice and applied once:

<<< ./projections/testingProjections.snippet.ts#idempotent-projection

For raw SQL projections, deletion, and multi-stream projections, see [Test a Projection](/guides/projections#test) in the Read Models guide.

## Choose the Right Level {#choose-level}

**The proportion between the levels is up to you**, but one rule keeps it honest: put each test at the lowest level that can fail for the reason you care about.

- A **business rule** breaks in the decision, so test it as a unit. Most of your tests live here.
- **Wiring** (mapping, validation, status codes, concurrency) breaks above the decision, so test it in-memory.
- **Serialisation and queries** break against the database, so keep a lean end-to-end and projection set for those.

Cover each concern once. Running the same scenario through all three levels buys the same confidence three times over, and you'll pay for it again on every future change. Once the in-memory tests are this cheap, you can lean on them; [Martin Thwaites makes that case well](https://www.youtube.com/watch?v=prLRI3VEVq4).

## Best Practices {#best-practices}

### Assert Behaviour, Not State {#best-practices-behaviour}

Check the events a decision returns and the documents a projection writes, never the intermediate state the code built along the way. Events and documents are the contract other code depends on; internal state is free to change under a refactor, and your tests shouldn't break when it does.

### Make Time and External Data Injectable {#best-practices-inject-dependencies}

Route the current time through command metadata and inject dependencies like the price lookup, so a test can fix them. The specifications above pass `() => now` and `() => Promise.resolve(unitPrice)`, which is why the expected `addedAt` and totals come out as exact values.

### Give Every Test Its Own Stream {#best-practices-isolate}

Share the container and store across a suite, but give each test a fresh stream id from `randomUUID` in `beforeEach`, so no test can see another's events. The [integration spec](https://github.com/event-driven-io/emmett/blob/main/src/docs/snippets/gettingStarted/webApi/apiBDD.int.spec.ts) shows the pattern.

## Troubleshooting {#troubleshooting}

### A Timestamp Assertion Fails By Milliseconds {#troubleshooting-timestamps}

The decision is reading the wall clock instead of an injected time. Route time through command metadata and inject a fixed clock into the API setup, as [Make Time and External Data Injectable](#best-practices-inject-dependencies) shows, and the expected value lands exactly.

### The Suite Is Slow {#troubleshooting-containers}

A container is starting per test. Start one in `beforeAll`, reuse it, and give each test a fresh stream id instead. Close the store and stop the container in `afterAll` so connections get released.

## Further Readings {#readings}

- [Getting Started - Unit Testing](/getting-started#unit-testing)
- [Command Handling](/guides/command-handling) - the handler these tests exercise
- [Read Models](/guides/projections) - testing projections in detail
- [API Reference: Decider](/api-reference/decider) - the specification helpers
- [Behaviour-Driven Design is more than tests](https://event-driven.io/en/behaviour_driven_design_is_not_about_tests/)
- [Testing Event Sourcing, Emmett edition](https://event-driven.io/en/testing_event_sourcing_emmett_edition/)
- [Building Operable Software with TDD](https://www.youtube.com/watch?v=prLRI3VEVq4)
