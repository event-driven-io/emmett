---
title: Quick start
documentationType: tutorial
---

In this tutorial we will create an application that can increase and decrease a counter. Along this way you will experience the fundamental mechanics and basic building blocks of Emmett.

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
package name: (emmet-quick-start)
version: (1.0.0)
description:
entry point: (index.js) dist/index.js
test command:
git repository:
keywords:
author:
license: (ISC)
About to write to /home/tobias/projekte/emmet-quick-start/package.json:

{
  "name": "emmet-quick-start",
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

Now install TypeScript:

```sh [npm]
npm install typescript @types/node --save-dev
```

The output should look like this:

```text
added 3 packages, and audited 4 packages in 1s

found 0 vulnerabilities
```

Now we initialize TypeScript using

```sh
npx tsc --init --target ESNEXT --outDir dist --module nodenext --moduleResolution nodenext
```

The output should look like this:

```text
Created a new tsconfig.json with:

  target: es2016
  module: commonjs
  strict: true
  esModuleInterop: true
  skipLibCheck: true
  forceConsistentCasingInFileNames: true


You can learn more at https://aka.ms/tsconfig
```

Then add the `build:ts` and `build:ts:watch` targets to your package.json:

```json{7-8}
{
  "name": "emmet-quick-start",
  "version": "1.0.0",
  "description": "",
  "main": "dist/index.js",
  "scripts": {
    "build:ts": "tsc",
    "build:ts:watch": "tsc -b --watch"
  },
  "author": "",
  "license": "ISC",
  "devDependencies": {
    "@types/node": "^22.13.10",
    "typescript": "^5.8.2"
  },
  "dependencies": {
    "@event-driven-io/emmett": "^0.34.0"
  }
}
```

Let us add an empty `index.ts` file as entrypoint for our application:

```sh
touch index.ts
```

> [!NOTE]
> In real-life applications, we might want to consider improving the project structure later on. However premature optimization is the root of all evil, so let us start simple and evolve later.

Test your configuration by running

::: code-group

```sh [npm]
npm run build:ts
```

```text [View output]
$ npm run build:ts

> emmet-quick-start@1.0.0 build:ts
> tsc

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

## Writing a simple counter application

Let us write a simple counter application using the four basic building blocks in Emmett: _Commands_, _command handlers_, _events_ and the _event store_.

### Defining the counter

Let us define how our counter should look like:

```ts
type Counter = {
  value: number;
};
```

### Create the initial state

We cannot start from just anywhere. That is why we need a function that returns the initial state of our counter:

```ts
export function initialState(): Counter {
  return {
    value: 0,
  };
}
```

Now the counter starts with `value = 0`.`

### Commands

Commands\_ are instructions to the application to perform a certain operation like \_Increment counter!

Our application needs to perform the following operations:

- Increment the counter
- Decrement the counter

Let us first create a command to increment the counter in `index.ts` and another to decrement it:

```ts
import type { Command } from '@event-driven-io/emmett';

// Command<type, payload>
export type IncrementCounter = Command<
  // Type
  'IncrementCounter',
  // Payload
  {
    by: number;
  }
>;

// Command<type, payload>
export type DecrementCounter = Command<
  // Type
  'DecrementCounter',
  // Payload
  {
    by: number;
  }
>;

// Union type of all possible commands (for later)
export type CounterCommand = IncrementCounter | DecrementCounter;
```

This declares a command whose type is `IncrementCounter` (or `DecrementCounter`) and whose payload has a `by` property of type `number`. This `by` property specifies by how much the counter should be incremented (or decremented).

Last but not least, we define a type `CounterCommand` that accomodates all commands. This way we can easily extend the list of possible commands using union types without having to change the code in other places.

> [!NOTE]
> The command is only a _request_ to increment the counter (perform the operation). Depending on the outcome, this request can be successful or not.

### Events

_Events_ record that something happened in the past, e.g. `counter incremented`. They are immutable facts that _cannot be changed anymore_.

Before we can put things together, we need to define our _counter incremented_ event. Also we define a `CounterEvent` type to accomodate all events:

```ts
import type { Event } from '@event-driven-io/emmett';

export type CounterIncremented = Event<
  'CounterIncremented',
  {
    by: number;
  }
>;

export type CounterDecremented = Event<
  'CounterDecremented',
  {
    by: number;
  }
>;

// Union type of all possible counter events (for later)
export type CounterEvent = CounterIncremented | CounterDecremented;
```

We use this type to record that our counter has been incremented (or decremented) by the amount in the `by` property.

### Turning commands into events

Now we need to put the commands and events together using _command handler_ functions:

```ts
export function incrementCounter(
  command: IncrementCounter,
  state: Counter,
): CounterIncremented {
  return {
    type: 'CounterIncremented',
    data: {
      by: command.data.by,
    },
  };
}

export function decrementCounter(
  command: DecrementCounter,
  state: Counter,
): CounterDecremented {
  return {
    type: 'CounterDecremented',
    data: {
      by: command.data.by,
    },
  };
}
```

This function is responsible for deciding the outcome of the command using buisiness rules. We have none, so we simply pass the amount using the `data.by` property of the `command`.

Emmett promotes the following _decider_ pattern that is easily extensible for more commands:

```ts
export function decide(command: CounterCommand, state: Counter): CounterEvent {
  const { type } = command;

  switch (type) {
    case 'IncrementCounter':
      return incrementCounter(command, state);
    case 'DecrementCounter':
      return decrementCounter(command, state);
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command type`);
    }
  }
}
```

This simply calls the correct _command handler_ function based on the `type` of the command.

### Calculating the next counter value

Finally we need to _evolve_ our counter. Given a current state (value) of the counter, we increment or decrement the it based on the value in the event. The pattern is pretty similar to the decider pattern, except that we take an old counter and an event to compute the next counter value:

```ts
export function evolve(state: Counter, event: CounterEvent): Counter {
  const { type, data } = event;

  switch (type) {
    case 'CounterIncremented': {
      return {
        ...state,
        value: state.value + data.by,
      };
    }
    case 'CounterDecremented': {
      return {
        ...state,
        value: state.value - data.by,
      };
    }
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command type`);
    }
  }
}
```

Finally we can declare our _command handler_ itself:

```ts
export const handle = CommandHandler({ evolve, initialState });
```

### Putting it all together with an event store

The _Event Store_ records a series of all the events that occurred in our application, similar to a cassette tape.

Starting from the initial state, it collates all events using the `evolve` function (basically left reducing the event stream).

For example:

```ts
// Inital state: Counter (value: 0)
CounterIncremented(by: 5) // Counter(value: 5)
CounterDecremented(by: 4) // Counter(value: 1)
CounterIncremented(by: 10) // Counter(value: 11)
CounterDecremented(by: 10) // Counter(value: 1)
```

These events are stored inside the `EventStore`. Emmet provides several implementations of event stores. For simplicity we use the _in-memory event store_:

```ts
import { getInMemoryEventStore } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();
```

Next let us define a few example commands:

```ts
const incrementBy5: IncrementCounter = {
  type: 'IncrementCounter',
  data: {
    by: 5,
  },
};

const incrementBy10: IncrementCounter = {
  type: 'IncrementCounter',
  data: {
    by: 10,
  },
};

const incrementBy0: IncrementCounter = {
  type: 'IncrementCounter',
  data: {
    by: 0,
  },
};

const decrementBy4: DecrementCounter = {
  type: 'DecrementCounter',
  data: {
    by: 4,
  },
};

const decrementBy10: DecrementCounter = {
  type: 'DecrementCounter',
  data: {
    by: 10,
  },
};
```

We can pass these to the `handle` function that we previously defined and use our decider for "routing" the commands to the correct methods:

```ts
const counterId = '1';

// 2. Handle command
await handle(eventStore, counterId, (state) => decide(incrementBy5, state));
console.log('---');
await handle(eventStore, counterId, (state) => decide(decrementBy4, state));
console.log('---');
await handle(eventStore, counterId, (state) => decide(incrementBy10, state));
console.log('---');
await handle(eventStore, counterId, (state) => decide(decrementBy10, state));
```

As a final step, let us tweak the `evolve` function to log the current state, the event data and the next state to the console:

```ts{5-11,14-20}
export function evolve(state: Counter, event: CounterEvent): Counter {
  const { type, data } = event;
  switch (type) {
    case "CounterIncremented": {
      const nextState = {
        ...state,
        value: state.value + data.by,
      };
      console.log(`${type}(by: ${data.by}) // Counter(value: ${nextState.value})`);
      return nextState;
    }
    case "CounterDecremented": {
      const nextState = {
        ...state,
        value: state.value - data.by,
      };
      console.log(`${type}(by: ${data.by}) // Counter(value: ${nextState.value})`);
      return nextState;
    }
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command type`);
    }
  }
}
```

This results in the following output:

```ts
CounterIncremented(by: 5) // Counter(value: 5)
---
CounterIncremented(by: 5) // Counter(value: 5)
CounterDecremented(by: 4) // Counter(value: 1)
---
CounterIncremented(by: 5) // Counter(value: 5)
CounterDecremented(by: 4) // Counter(value: 1)
CounterIncremented(by: 10) // Counter(value: 11)
---
CounterIncremented(by: 5) // Counter(value: 5)
CounterDecremented(by: 4) // Counter(value: 1)
CounterIncremented(by: 10) // Counter(value: 11)
CounterDecremented(by: 10) // Counter(value: 1)
```

Why does it look that way?
Initially there is only one event in the stream, then two, then three, then four. Whenever an event is appended to the stream, the whole stream is re-read to calculate the next state.

## Summary

This tutorial has shown you the fundamental building blocks of Emmett. However there is more to it, as we skipped important topics like testing, persistence for event stores and API integrations to make the data available to the outside world.

Here is the full source code for reference:

```ts
import {
  CommandHandler,
  EmmettError,
  event,
  type Command,
  type Event,
} from '@event-driven-io/emmett';

type Counter = {
  value: number;
};

export function initialState(): Counter {
  return {
    value: 0,
  };
}

// Command<type, payload>
export type IncrementCounter = Command<
  // Type
  'IncrementCounter',
  // Payload
  {
    by: number;
  }
>;

// Command<type, payload>
export type DecrementCounter = Command<
  // Type
  'DecrementCounter',
  // Payload
  {
    by: number;
  }
>;

// Union type of all possible commands (for later)
export type CounterCommand = IncrementCounter | DecrementCounter;

export type CounterIncremented = Event<
  'CounterIncremented',
  {
    by: number;
  }
>;

export type CounterDecremented = Event<
  'CounterDecremented',
  {
    by: number;
  }
>;

// Union type of all possible counter events (for later)
export type CounterEvent = CounterIncremented | CounterDecremented;

export function incrementCounter(
  command: IncrementCounter,
  state: Counter,
): CounterIncremented {
  return {
    type: 'CounterIncremented',
    data: {
      by: command.data.by,
    },
  };
}

export function decrementCounter(
  command: DecrementCounter,
  state: Counter,
): CounterDecremented {
  return {
    type: 'CounterDecremented',
    data: {
      by: command.data.by,
    },
  };
}

export function decide(command: CounterCommand, state: Counter): CounterEvent {
  const { type } = command;
  switch (type) {
    case 'IncrementCounter':
      return incrementCounter(command, state);
    case 'DecrementCounter':
      return decrementCounter(command, state);
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command type`);
    }
  }
}

export function evolve(state: Counter, event: CounterEvent): Counter {
  const { type, data } = event;
  switch (type) {
    case 'CounterIncremented': {
      const nextState = {
        ...state,
        value: state.value + data.by,
      };
      console.log(
        `${type}(by: ${data.by}) // Counter(value: ${nextState.value})`,
      );
      return nextState;
    }
    case 'CounterDecremented': {
      const nextState = {
        ...state,
        value: state.value - data.by,
      };
      console.log(
        `${type}(by: ${data.by}) // Counter(value: ${nextState.value})`,
      );
      return nextState;
    }
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command type`);
    }
  }
}

export const handle = CommandHandler({ evolve, initialState });

import { getInMemoryEventStore } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();

const incrementBy5: IncrementCounter = {
  type: 'IncrementCounter',
  data: {
    by: 5,
  },
};

const incrementBy10: IncrementCounter = {
  type: 'IncrementCounter',
  data: {
    by: 10,
  },
};

const decrementBy4: DecrementCounter = {
  type: 'DecrementCounter',
  data: {
    by: 4,
  },
};

const decrementBy10: DecrementCounter = {
  type: 'DecrementCounter',
  data: {
    by: 10,
  },
};

const counterId = '1';

// 2. Handle command
await handle(eventStore, counterId, (state) => decide(incrementBy5, state));
console.log('---');
await handle(eventStore, counterId, (state) => decide(decrementBy4, state));
console.log('---');
await handle(eventStore, counterId, (state) => decide(incrementBy10, state));
console.log('---');
await handle(eventStore, counterId, (state) => decide(decrementBy10, state));
```

## Next steps

For diving deeper into Emmett, please check out the [Getting Started](/getting-started) user guide which will demonstrate Emmetts features more comprehensively.
