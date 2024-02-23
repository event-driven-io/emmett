# Getting Started

![](/logo.png)

## Event Sourcing

**Event Sourcing is architecting for tomorrow's questions. Which is essential as today's decisions are tomorrow's context.** We keep all the facts that happened in our system. Facts are stored as events that can be used to make decisions, fine-tune read models, integrate our systems, and enhance our analytics and tracking. All in one package, wash and go!

This simple pattern allows easier integration, building applications from smaller building blocks, keeping the cognitive load and coupling on a leash.

Yet, some say that's complex and complicated; Emmett aims to prove that it doesn't have to be like that. We cut the boilerplate and layered madness, letting you focus on delivery. We're opinionated but focus on composition, not magic. Let me show you how.

## Installation

Before we dive into the real world's scenario, let's add Emmett to your project, as we'll use its types and tooling to streamline the development effort.

I assume that you have Node.js installed. Add the package from the terminal using your favourite package manager:

::: code-group

```sh [npm]
$ npm add @event-driven-io/emmett
```

```sh [pnpm]
$ pnpm add @event-driven-io/emmett
```

```sh [yarn]
$ yarn add @event-driven-io/emmett
```

```sh [bun]
$ bun add @event-driven-io/emmett
```

:::

## Events

**Events are the centrepiece of event-sourced systems.** They represent both critical points of the business process but are also used as the state. That enables you to reflect your business into the code better, getting the synergy. Let's model a simple business process: a shopping cart. You can open it, add or remove the product from it and confirm or cancel.

We could define it as follows:

<<< @/snippets/gettingStarted/events.ts#getting-started-events

It shows that clients can add or remove products to our shopping cart and confirm or cancel them. All events represent facts that happened and tell the story of the shopping cart. To highlight that, we're grouping all type definitions with the `ShoppingCartEvent` union type. It tells that either of those events may happen.

We're using [Event type](/api-docs.md#event), which helps to keep the event definition aligned. It's not a must, but it helps to ensure that it has a type name defined (e.g. `ProductItemAddedToShoppingCart`) and read-only payload data.

## Commands

We need to provide a clear business intention to capture a meaningful business event. We can declare it by defining the set of commands to tell what business logic we'll be handling:

<<< @/snippets/gettingStarted/commands.ts#getting-started-commands

Accordingly, to define the event, we're using the [`Command` type](/api-docs.md#command), ensuring that our type definition is aligned. Using the `Command` type is optional, as Emmett won't force you to use any marker types, but with [TypeScript structural typing](https://event-driven.io/en/structural_typing_in_type_script/), this is quite useful to align the type definition.

## Business logic and decisions

Knowing what may happen (events) and our business intentions (commands), we can define our business logic.

::: info Let's say that we have the following business rules:

1. The customer must provide the quantity when selecting and adding a product to the basket. The system calculates the product price based on the current price list.
2. The customer may remove a product with a given price from the cart.
3. The customer can confirm the shopping cart and start the order fulfilment process.
4. The customer may cancel the shopping cart and reject all selected products.
5. After shopping cart confirmation or cancellation, the product can no longer be added or removed from the cart.

:::

To evaluate business rules, it'd be helpful if we had the current state in which we could make our decisions. It could look as follows:

<<< @/snippets/gettingStarted/state.ts#getting-started-state

Simple as that. No additional classes are needed. Our shopping cart can be either _Empty_ (initial state), _Opened_ (we added or removed items) or _Closed_ (confirmed or cancelled). Based on the above rules, it's enough to keep product items as a simple map with product id and the record with price and quantity.

::: tip Keep your state slimmed down

It's essential to keep our state focused on decision-making. We should trim it to only contain data used in our business rules evaluation. Read more in the [article](https://event-driven.io/en/slim_your_entities_with_event_sourcing/)

:::

Now, let's define our business logic! We can do it through a set of functions:

<<< @/snippets/gettingStarted/businessLogic.ts#getting-started-business-logic

As you see, this is a simple set of functions with a repeatable pattern. They take command and the state and a make decision. The result of business logic is always an event (or multiple events). If business rules validation fails, you can either throw an error or return a failure result (it can also be another event), but I'll let you decide on your preferences.

We can also wrap the whole processing into a single function:

<<< @/snippets/gettingStarted/businessLogic.ts#getting-started-business-logic-decide

Such repeatable patterns are powerful, as they open easier composition, which is the base of _the Emmett way_.

## Building state from events

We know how to run business logic based on state and command. Yet, in event sourcing, events are the state.

Each event recorded due to the business logic is appended to the event stream. An event stream is an ordered sequence of events. Event stream id equals the entity id (e.g. shopping cart id). To get the current state of events, we need to read all events previously recorded. Then, we take the initial state and apply it one by one to get the current state at the time. Yes, the state we'll use in business logic.

The state aggregation can be coded as:

```typescript
const currentState = events.reduce<State>(evolve, getInitialState());
```

For our case initial state can look like:

<<< @/snippets/gettingStarted/state.ts#getting-started-state-default

Now let's define the `evolve` function that will evolve our state based on events:

<<< @/snippets/gettingStarted/state.ts#getting-started-state-evolve

Read also more in article [How to get the current entity state from events?]() and follow up on [Should you throw an exception when rebuilding the state from events?](https://event-driven.io/en/should_you_throw_exception_when_rebuilding_state_from_events/).

## Testing

One of the mentioned benefits is testing, which Emmett helps to do out of the box.

::: tip For Event Sourcing, the testing pattern looks like this:

- **GIVEN** set of events recorded for the entity,
- **WHEN** we run the command on the state built from events,
- **THEN** we’re getting new event(s) as a result of business logic. Or the exception is thrown.

:::

Tests for our Shopping Cart business logic can look like this:

<<< @/snippets/gettingStarted/businessLogic.unit.spec.ts#getting-started-unit-tests

## Event store

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

## Application Logic and WebApi

Seems like we have our business rules modelled, business logic reflected in code, and even tested. Isn't that cool? That's nice, but we need to build real applications, which nowadays typically mean a Web Application. Let's try to do it as well.

Node.js is a great, lightweight environment that doesn't require much ceremony. Some tools try to bring, but we want to keep it simple in Emmett. What could be simpler than building an Express.js application?

Let's add some flavour to the classical Express.js app by installing the `emmett-expressjs` package:

::: code-group

```sh [npm]
$ npm add @event-driven-io/emmett-expressjs
```

```sh [pnpm]
$ pnpm add @event-driven-io/emmett
```

```sh [yarn]
$ yarn add @event-driven-io/emmett
```

```sh [bun]
$ bun add @event-driven-io/emmett
```

:::

We don't want to replace your favourite frameworks but get synergy with them. We want to help you cut the boilerplate by providing safe defaults to the configuration and simple wrappers. The example?

<<< @/snippets/gettingStarted/webApi/start.ts#getting-started-webApi-startApi

Those are just a few lines, but there are a few things to discuss here. Let's tackle them one by one.

We'll use the simplest option for this guide: an in-memory event store. For a real application, you'd need to use another, e.g. EventStoreDB implementation.
