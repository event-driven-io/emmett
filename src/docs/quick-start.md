---
documentationType: tutorial
outline: 'deep'
---

# Quick start

In this tutorial, we will create an application that can add and remove items from a shopping cart. Along the way, you will experience the fundamental mechanics and basic building blocks of Emmett.

## Create a Node.js project

Before installing and using Emmett, we need to set up a Node.js project and add Typescript support.
To do so, first create a project directory and switch to it:

```sh
mkdir emmett-quick-start
cd emmett-quick-start
```

::: code-group

```sh [npm]
npm init
```

```sh [pnpm]
pnpm init
```

```sh [yarn]
yarn init
```

```sh [bun]
bun init
```

:::

For now, just accept the defaults.

> [!NOTE]
> For the sake of brevity, we will focus on using `npm` as a package manager in this tutorial.

The output should look similar to this:

```text
package name: (emmett-quick-start)
version: (1.0.0)
description:
entry point: (index.js) dist/index.js
test command:
git repository:
keywords:
author:
license: (ISC)
About to write to /home/tobias/projekte/emmett-quick-start/package.json:

{
  "name": "emmett-quick-start",
  "version": "1.0.0",
  "description": "",
  "main": "dist/index.js",
  "scripts": {
    "test": ""
  },
  "author": "",
  "license": "ISC"
}


Is this OK? (yes)
```

### Add TypeScript support

Now install TypeScript and `tsx` as dev dependencies for running our code:

::: code-group

```sh [npm]
npm install typescript @types/node tsx --save-dev
```

```txt [View output]
added 3 packages, and audited 4 packages in 1s

found 0 vulnerabilities
```

:::

Now, we initialize TypeScript using:

::: code-group

```sh [npm]
npx tsc --init --target ESNEXT --outDir dist --module nodenext --moduleResolution nodenext
```

```txt [View output]

Created a new tsconfig.json with:

  target: es2016
  module: commonjs
  strict: true
  esModuleInterop: true
  skipLibCheck: true
  forceConsistentCasingInFileNames: true


You can learn more at https://aka.ms/tsconfig
```

:::

### Running your application

Add the `start` target to your `package.json`:
::: code-group

<<< @/snippets/quickStart/package.json{7}

:::

Let us add an empty `index.ts` file as entrypoint for our application:

```sh
touch index.ts
```

To run your application, use the following command:

::: code-group

```sh [npm]
npm run start
```

```txt [View output]
$ npm run build:ts

> emmett-quick-start@1.0.0 start
> tsx ./index.ts

```

:::

### Add Emmett as a dependency

::: code-group

```sh [npm]
npm add @event-driven-io/emmett
```

```sh [pnpm]
pnpm add @event-driven-io/emmett
```

```sh [yarn]
yarn add @event-driven-io/emmett
```

```sh [bun]
bun add @event-driven-io/emmett
```

:::

## Writing a simple shopping cart application

Let us write a simple shopping cart application using Emmett's four basic building blocks: _Commands_, _command handlers_, _events_, and the _event store_.

### Defining the shopping cart

First, open the `index.ts` file that we created previously. Then let us define a type for how our shopping cart should look like:

<<< @/snippets/quickStart/index.ts#state-definition

### Create the initial state

We cannot start from just anywhere. That is why we need a function that returns the initial state of our shopping cart:

<<< @/snippets/quickStart/index.ts#initial-state

This creates a new empty shopping cart

### Commands

Commands are instructions to the application to perform a particular operation, like _Add item to shopping cart_!

Our application needs to perform the following operations:

- Add item: Add an item by its name
- Remove item: Remove an item by its name

Let us first create a command to add an item in `index.ts` and another to remove one:

<<< @/snippets/quickStart/index.ts#commands

This declares a command whose type is `AddItem` (or `RemoveItem`) and whose payload has a `name` property of type `string`. The `name` property specifies the item's name that should be added to or removed from the cart.

Last but not least, we define a type `ShoppingCartCommand` that accommodates all commands. This way, we can easily extend the list of possible commands using union types without having to change the code elsewhere.

> [!NOTE]
> The command is only an _intention_ to perform the operation, e.g. add an item to the cart. Depending on the outcome, this request may or may not be successful.

### Events

_Events_ record that something happened in the past, e.g. `item was added to shopping cart`. They are immutable facts that _cannot be changed anymore_.

Before we can put things together, we need to define our _item added_ event. Also, we define a `ShoppingCartEvent` type to accommodate all events:

<<< @/snippets/quickStart/index.ts#events

We use this type to record that our item has been added to (or removed from) the shopping cart.

### Recording events

Now we need to put the commands and events together using _command handler_ functions:

<<< @/snippets/quickStart/index.ts#state-definition

This function is responsible for deciding the command's outcome using business rules (e.g., items may not be added more than once). Currently, there are none, so we simply pass the name using the `data.name` property of the `command`.

You can group all commands into a unified function that is easily extensible when you add more commands:

<<< @/snippets/quickStart/index.ts#decider

This calls the correct _command handler_ function based on the command's `type` and returns an event (or an array of events) that will be recorded and stored in the event store further below.

### Calculating the next shopping cart

Finally, we need to _evolve_ our shopping cart. Given the shopping cart's current state (items), we add or remove items based on the `name` in the event. The pattern is pretty similar to the decider pattern, except that we take a shopping cart and an event to compute the next state:

<<< @/snippets/quickStart/index.ts#evolve

Finally, we can declare the _command handler_ itself:

<<< @/snippets/quickStart/index.ts#handle

### Putting it all together with an event store

[The _event store_ is logically a key-value database](https://event-driven.io/en/event_stores_are_key_value_stores/?utm_source=emmett) that records series of events that happened in our application. It logically groups events in streams. In the traditional approach, a stream represents a record. Each instance of the process or entity will have its own stream. That means that it also has its own ID, and the value is a sequence of events recorded for this process or entity (e.g., all the events for a certain shopping cart).

Starting from the initial state, it folds all events using the `evolve` function (basically left reducing the event stream).

For example:

```ts
// Inital state: ShoppingCart (items: [])
ItemAdded(name: Pizza) // ShoppingCart(items: Pizza)
ItemAdded(name: Ice Cream) // ShoppingCart(items: Pizza, Ice Cream)
ItemRemoved(name: Ice Cream) // ShoppingCart(items: Pizza)
```

These events are stored inside the `EventStore`. Emmett provides several implementations of event stores. For simplicity, we use the _in-memory event store_:

<<< @/snippets/quickStart/index.ts#event-store

Next let us define a few example commands:

<<< @/snippets/quickStart/index.ts#example-commands

We can pass these to the `handle` function that we previously defined and use our decider for "routing" the commands to the correct methods:

<<< @/snippets/quickStart/index.ts#handle-example-commands

This results in the following output:

```ts
ItemAdded(name: Pizza) // ShoppingCart(items: Pizza)
---
ItemAdded(name: Pizza) // ShoppingCart(items: Pizza)
ItemAdded(name: Ice Cream) // ShoppingCart(items: Pizza, Ice Cream)
---
ItemAdded(name: Pizza) // ShoppingCart(items: Pizza)
ItemAdded(name: Ice Cream) // ShoppingCart(items: Pizza, Ice Cream)
ItemRemoved(name: Ice Cream) // ShoppingCart(items: Pizza)
```

Why does it look that way?
Initially, there is only one event in the stream, then two, three, and four. Whenever an event is appended to the stream, the whole stream is re-read to calculate the next state.

One key aspect is that this behaviour allows us to change the code to build the current state of the shopping cart (e.g., just count the number of items in the cart) without any negative side effects.

### Business perspective

In the final round, the ice cream was added and then removed again. In a traditional state-sourced database, it is impossible to see from the cart state that the ice cream has been in the cart.

In event-sourced applications, we keep a record of all relevant events to the business. In this case, we might want to change the code to send a newsletter with a 50 % discount on ice cream to people who removed it from the cart to increase ice cream sales.

Moreover, we can implement such a feature retroactively by replaying all events from the event store for all events recorded before our feature existed. That means we can defer these kinds of decisions to when they become necessary from a business perspective without severe drawbacks.

## Summary

This tutorial has shown you the fundamental building blocks of Emmett. However, there is more to it, as we skipped essential topics like testing, persistence for event stores and API integrations to make the data available to the outside world.

## Next steps

**Check the [Getting Started guide](/getting-started) to learn more about building a real web API with PostgreSQL storage.**

## Full implementation

Here is the full source code for reference:

<<< @/snippets/quickStart/index.ts
