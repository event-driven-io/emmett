---
title: Quick start
documentationType: tutorial
---

In this tutorial we will create an application that can add and remove items to/from a shopping cart. Along this way you will experience the fundamental mechanics and basic building blocks of Emmett.

## Create a Node.js project

Before we can install and use Emmett, we need to set up a Node.js project and add Typescript support.
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
> For the sake of brevity, we will focus on using `npm` as package manager in this tutorial.

The output should look like this:

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

## Add TypeScript

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

Now we initialize TypeScript using

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

Then add the `start` target to your package.json:

<<< @/snippets/quickStart/package.json{7}

Let us add an empty `index.ts` file as entrypoint for our application:

```sh
touch index.ts
```

> [!TIP]
> In this example we are going to add all our source code to just `index.ts`. For real-life applications, we might want to consider improving the project structure, e.g. by having a separate source folder later on.

Test your configuration by running

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

## Add Emmett as dependency

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

Let us write a simple shopping cart application using the four basic building blocks in Emmett: _Commands_, _command handlers_, _events_ and the _event store_.

### Defining the shopping cart

First open the `index.ts` file that we created previously. Then let us define a type for how our shopping cart should look like:

<<< @/snippets/quickStart/index.ts#state-definition

### Create the initial state

We cannot start from just anywhere. That is why we need a function that returns the initial state of our shopping cart:

<<< @/snippets/quickStart/index.ts#initial-state

This creates a new empty shopping cart

### Commands

Commands are instructions to the application to perform a certain operation like _Add item to shopping cart_!

Our application needs to perform the following operations:

- Add item: Add an item by its name
- Remove item: Remove an item by its name

Let us first create a command to add an item in `index.ts` and another to remove one:

<<< @/snippets/quickStart/index.ts#commands

This declares a command whose type is `AddItem` (or `RemiveUten`) and whose payload has a `name` property of type `string`. This `name` property specifies the name of the item that should be added to or removed from the cart.

Last but not least, we define a type `ShoppingCartCommand` that accomodates all commands. This way we can easily extend the list of possible commands using union types without having to change the code in other places.

> [!NOTE]
> The command is only a _request_ to perform the operation, e.g. to add an item to the cart. Depending on the outcome, this request can be successful or not.

### Events

_Events_ record that something happened in the past, e.g. `item was added to shopping cart`. They are immutable facts that _cannot be changed anymore_.

Before we can put things together, we need to define our _item added_ event. Also we define a `ShoppingCartEvent` type to accomodate all events:

<<< @/snippets/quickStart/index.ts#events

We use this type to record that our item has been added to (or removed from) the shopping cart.

### Turning commands into events

Now we need to put the commands and events together using _command handler_ functions:

<<< @/snippets/quickStart/index.ts#state-definition

This function is responsible for deciding the outcome of the command using business rules (e.g. items may not be added more than once). Currently there are none, so we simply pass the name using the `data.name` property of the `command`.

Emmett promotes the following _decider_ pattern that is easily extensible for more commands:

<<< @/snippets/quickStart/index.ts#decider

This calls the correct _command handler_ function based on the `type` of the command.

### Calculating the next shopping cart

Finally we need to _evolve_ our shopping cart. Given a current state (items) of the shopping cart, we add or remove items based on the `name` in the event. The pattern is pretty similar to the decider pattern, except that we take an shopping cart and an event to compute the next state:

<<< @/snippets/quickStart/index.ts#evolve

Finally we can declare the _command handler_ itself:

<<< @/snippets/quickStart/index.ts#handle

### Putting it all together with an event store

The _Event Store_ records a series of all the events that occurred in our application, similar to a cassette tape.

Starting from the initial state, it collates all events using the `evolve` function (basically left reducing the event stream).

For example:

```ts
// Inital state: ShoppingCart (items: [])
ItemAdded(name: Pizza) // ShoppingCart(items: Pizza)
ItemAdded(name: Ice Cream) // ShoppingCart(items: Pizza, Ice Cream)
ItemRemoved(name: Ice Cream) // ShoppingCart(items: Pizza)
```

These events are stored inside the `EventStore`. Emmett provides several implementations of event stores. For simplicity we use the _in-memory event store_:

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
Initially there is only one event in the stream, then two, then three, then four. Whenever an event is appended to the stream, the whole stream is re-read to calculate the next state.

## Summary

This tutorial has shown you the fundamental building blocks of Emmett. However there is more to it, as we skipped important topics like testing, persistence for event stores and API integrations to make the data available to the outside world.

Here is the full source code for reference:

<<< @/snippets/quickStart/index.ts

## Next steps

For diving deeper into Emmett, please check out the [Getting Started](/getting-started) user guide which will demonstrate Emmett's features more comprehensively.
