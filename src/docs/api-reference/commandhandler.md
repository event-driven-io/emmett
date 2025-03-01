# Command Handler

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
    initialState,
  },
);

const events = handle(command, state);

await eventStore.appendToStream(streamName, result, { expectedStreamVersion });
```

That looks quite simple, but generalising it and making it robust requires some experience. But that's why you have Emmett, the intention is to cut the learning curve for you and help you with basic abstractions.

## Usage

You can use the `CommandHandler` method to set up a command handler for you:

<<< @/snippets/gettingStarted/commandHandler.ts#command-handler

Such handlers should be defined per stream type (e.g., one for Shopping Cart, the other for Orders, etc.). It can be used later in the application code as:

<<< @/snippets/gettingStarted/commandHandling.ts#command-handling

## Definition

<<< @./../packages/emmett/src/commandHandling/handleCommand.ts#command-handler