---
outline: deep
---

# API docs

## Event

**Events are the centrepiece of event-sourced systems.** They represent both critical points of the business process but are also used as the state. That enables you to reflect your business into the code better, getting the synergy. Let's model a simple business process: a shopping cart. You can open it, add or remove the product from it and confirm or cancel.

Event type helps to keep the event definition aligned. It's not a must, but it helps to ensure that it has a type name defined (e.g. `ProductItemAddedToShoppingCart`) and read-only payload data.

You can use it as follows

<<< @/snippets/api/event.ts#event-type

The type is a simple wrapper to ensure the structure's correctness. It defines:

- **type** - event type name,
- **data** - represents the business data the event contains. It has to be a record structure; primitives are not allowed,
- **metadata** - represents the generic data event contains. It can represent telemetry, user id, tenant id, timestamps and other information that can be useful for running infrastructure. It has to be a record structure; primitives are not allowed.

See more context in [getting started guide](./getting-started.md#events)

<<< @./../packages/emmett/src/typing/event.ts

## Command

**Commands represent intention to perform business operation.** It targets a specific _audience_. It can be an application service and request with intention to “add user” or “change the order status to confirmed”. So the sender of the command must know the recipient and expects the request to be executed. Of course, the recipient may refuse to do it by not passing us the salt or throwing an exception during the request handling.

Command type helps to keep the command definition aligned. It's not a must, but it helps to ensure that it has a type name defined (e.g. `AddProductItemToShoppingCart`) and read-only payload data.

You can use it as follows

<<< @/snippets/api/command.ts#command-type

The type is a simple wrapper to ensure the structure's correctness. It defines:

- **type** - command type name,
- **data** - represents the business data the command contains. It has to be a record structure; primitives are not allowed,
- **metadata** - represents the generic data command contains. It can represent telemetry, user id, tenant id, timestamps and other information that can be useful for running infrastructure. It has to be a record structure; primitives are not allowed.

See more context in [getting started guide](./getting-started.md#commands)

<<< @./../packages/emmett/src/typing/command.ts

## Event Store

**Emmett is an Event Sourcing framework, so we need an event store to store events, aye?** [Event stores are key-value databases](https://event-driven.io/en/event_stores_are_key_value_stores/). The key is a record id, and the value is an ordered list of events. Such a sequence of events is called _Event Stream_. One stream keeps all events recorded for a particular business process or entity.

The essential difference between Event Sourcing and Event Streaming is that in Event Sourcing, events are the state. There's no other state. We use recorded events to get the state and make the next decisions, resulting in more events. Plus, as you'd expect from the database, we get strong consistency on writes and reads. Read more in [article](https://event-driven.io/en/event_streaming_is_not_event_sourcing/).

**Emmett provides a lightweight abstraction for event stores.** We don't intend to provide the lowest common denominator but streamline the typical usage patterns. It's OK if you use your preferred event store or client for the cases where those parts do not suffice your needs. Still, what's there should take you far enough.

Here is the general definition of it:

<<< @./../packages/emmett/src/eventStore/eventStore.ts#event-store

It brings you three most important methods:

- `readStream` - reads events for the specific stream. By default, it reads all events, but through options, you can specify the event range you want to get (`from`, `to`, `maxCount`). You can also specify the expected stream version.
- `appendToStream` - appends new events at the end of the stream. All events should be appended as an atomic operation. You can specify the expected stream version for an [optimistic concurrency check](https://event-driven.io/en/optimistic_concurrency_for_pessimistic_times/). We're also getting the next stream version as a result.
- `aggregateStream` - builds the current state from events. Internally, event store implementation should read all events in the stream based on the passed initial state and the `evolve` function. It also supports all the same options as the `readStream` method.

Read more about how event stores are built in the [article](https://event-driven.io/en/lets_build_event_store_in_one_hour/).

## Command Handler

**Event Sourcing brings a repeatable pattern for handling business logic.** We can expand that to application logic.

::: info Command Handling can be described by the following steps:

1. **Read events from the stream and build the state from them** (in other words _aggregate stream_). Get also the current version of the stream.
2. **Run the business logic using the command and the state.** Use the default (_initial_) state if the stream does not exist.
3. **Append the result of the business logic (so events) at the end of the stream** from which you've read events. Use the read version (or the one provided by the user) for an [optimistic concurrency check](https://event-driven.io/en/optimistic_concurrency_for_pessimistic_times/).

:::

In pseudo-code, this could look as follows:

```ts
const { state, expectedStreamVersion } = await eventStore.aggregateStream(
  streamName,
  {
    evolve,
    getInitialState,
  },
);

const events = handle(command, state);

await eventStore.appendToStream(streamName, result, { expectedStreamVersion });
```

That looks quite simple, but generalising it and making it robust requires some experience. But that's why you have Emmett, the intention is to cut the learning curve for you and help you with basic abstractions.

You can use the `CommandHandler` method to set up a command handler for you:

<<< @/snippets/gettingStarted/commandHandler.ts#command-handler

Such handlers should be defined per stream type (e.g., one for Shopping Cart, the other for Orders, etc.). It can be used later in the application code as:

<<< @/snippets/gettingStarted/commandHandling.ts#command-handling
