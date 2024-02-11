# Getting Started

![](/logo.png)

## Event Sourcing

**Event Sourcing keeps all the facts that happened in our system, and that's powerful!** Facts are stored as events that can be used to make decisions, fine-tune read models, integrate our systems, and enhance our analytics and tracking. All in one package, wash and go!

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

It's essential to keep our state focused on decision-making. We should trim it to only contain data used in our business rules evaluation.

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

## Testing

One of the mentioned benefits is testing, which Emmett helps to do out of the box.

::: tip For Event Sourcing, the testing pattern looks like this:

- **GIVEN** set of events recorded for the entity,
- **WHEN** we run the command on the state built from events,
- **THEN** we’re getting new event(s) as a result of business logic. Or the exception is thrown.

:::

Tests for our Shopping Cart business logic can look like this:

<<< @/snippets/gettingStarted/businessLogic.unit.test.ts#getting-started-unit-tests

Above tests use [Jest testing library](https://jestjs.io/), but you can use it in any other testing package, as it's fully independent.
