# Getting Started

## Event Sourcing

**Event Sourcing keeps all the facts that happened in our system, and that's powerful!** Facts are stored as events that can be used to make decisions, fine-tune read models, integrate our systems, and enhance our analytics and tracking. All in one package, wash and go!

Yet, some say that's complex and complicated; Emmett aims to prove that it doesn't have to be like that. We cut the boilerplate and layered madness, letting you focus on delivery. We're opinionated but focus on composition, not magic. Let me show you how.

## Installation

Before we dive into the real world's scenario, let's add Emmett to your project, as we'll use its types and tooling to streamline the development effort.

I assume that you have Node.js installed. Add the package from the terminal using your favourite package manager:

::: code-group

```sh [npm]
$ npm add -D @event-driven-io/emmett
```

```sh [pnpm]
$ pnpm add -D @event-driven-io/emmett
```

```sh [yarn]
$ yarn add -D @event-driven-io/emmett
```

```sh [bun]
$ bun add -D @event-driven-io/emmett
```

:::

## Events

**Events are the centrepiece of event-sourced systems.** They represent both critical points of the business process but are also used as the state. That enables you to reflect your business into the code better, getting the synergy. Let's model a simple business process: a shopping cart. You can open it, add or remove the product from it and confirm or cancel.

We could define it as follows:

<<< @/snippets/shoppingCart.ts#getting-started-events

It shows that clients can add or remove products to our shopping cart and confirm or cancel them. All events represent facts that happened and tell the story of the shopping cart. To highlight that, we're grouping all type definitions with the `ShoppingCartEvent` union type. It tells that either of those events may happen.

We're using [Event type](/api-docs.md#event), which helps to keep the event definition aligned. It's not a must, but it helps to ensure that it has a type name defined (e.g. `ProductItemAddedToShoppingCart`) and read-only payload data.
