# Event Store

**Emmett is an Event Sourcing framework, so we need an event store to store events, aye?** [Event stores are key-value databases](https://event-driven.io/en/event_stores_are_key_value_stores/). The key is a record id, and the value is an ordered list of events. Such a sequence of events is called _Event Stream_. One stream keeps all events recorded for a particular business process or entity.

The essential difference between Event Sourcing and Event Streaming is that in Event Sourcing, events are the state. There's no other state. We use recorded events to get the state and make the next decisions, resulting in more events. Plus, as you'd expect from the database, we get strong consistency on writes and reads. Read more in [article](https://event-driven.io/en/event_streaming_is_not_event_sourcing/).

**Emmett provides a lightweight abstraction for event stores.** We don't intend to provide the lowest common denominator but streamline the typical usage patterns. It's OK if you use your preferred event store or client for the cases where those parts do not suffice your needs. Still, what's there should take you far enough.

## Usage

Here is the general definition of it:

<<< @./../packages/emmett/src/eventStore/eventStore.ts#event-store

It brings you three most important methods:

- `readStream` - reads events for the specific stream. By default, it reads all events, but through options, you can specify the event range you want to get (`from`, `to`, `maxCount`). You can also specify the expected stream version.
- `appendToStream` - appends new events at the end of the stream. All events should be appended as an atomic operation. You can specify the expected stream version for an [optimistic concurrency check](https://event-driven.io/en/optimistic_concurrency_for_pessimistic_times/). We're also getting the next stream version as a result.
- `aggregateStream` - builds the current state from events. Internally, event store implementation should read all events in the stream based on the passed initial state and the `evolve` function. It also supports all the same options as the `readStream` method.

## Definition

<<< @./../packages/emmett/src/eventStore/eventStore.ts#event-store

## See also

Read more about how event stores are built in the [article](https://event-driven.io/en/lets_build_event_store_in_one_hour/).
