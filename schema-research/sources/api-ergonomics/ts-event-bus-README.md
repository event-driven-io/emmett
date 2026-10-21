# ts-event-bus

[![by Dashlane](https://rawgit.com/dashlane/ts-event-bus/master/by_dashlane.svg)](https://www.dashlane.com/)

[![Build Status](https://github.com/Dashlane/ts-event-bus/actions/workflows/nodejs.yml/badge.svg)](https://github.com/Dashlane/ts-event-bus/actions/workflows/nodejs.yml)
[![Dependency Status](https://david-dm.org/Dashlane/ts-event-bus.svg)](https://david-dm.org/Dashlane/ts-event-bus)

> [!CAUTION]
> This package is no longer maintained. It is strongly advised against using it in any new project.

Distributed messaging in Typescript

`ts-event-bus` is a lightweight distributed messaging system. It allows several modules, potentially distributed over different runtime spaces to communicate through typed messages.

## Getting started

### Declare your events

Using `ts-event-bus` starts with the declaration of the interface that your components share:

```typescript
// MyEvents.ts
import { slot, Slot } from "ts-event-bus";

const MyEvents = {
  sayHello: slot<string>(),
  getTime: slot<null, string>(),
  multiply: slot<{ a: number; b: number }, number>(),
  ping: slot<void>(),
};

export default MyEvents;
```

### Create EventBus

Your components will then instantiate an event bus based on this declaration, using whatever channel they may want to communicate on.
If you specify no `Channel`, it means that you will exchange events in the same memory space.

For instance, one could connect two node processes over WebSocket:

```typescript
// firstModule.EventBus.ts
import { createEventBus } from "ts-event-bus";
import MyEvents from "./MyEvents.ts";
import MyBasicWebSocketClientChannel from "./MyBasicWebSocketClientChannel.ts";

const EventBus = createEventBus({
  events: MyEvents,
  channels: [new MyBasicWebSocketClientChannel("ws://your_host")],
});

export default EventBus;
```

```typescript
// secondModule.EventBus.ts
import { createEventBus } from "ts-event-bus";
import MyEvents from "./MyEvents.ts";
import MyBasicWebSocketServerChannel from "./MyBasicWebSocketServerChannel.ts";

const EventBus = createEventBus({
  events: MyEvents,
  channels: [new MyBasicWebSocketServerChannel("ws://your_host")],
});
```

### Usage

Once connected, the clients can start by using the slots on the event bus

```typescript
// firstModule.ts
import EventBus from './firstModule.EventBus.ts'

// Slots can be called with a parameter, here 'michel'
EventBus.say('michel', 'Hello')

// Or one can rely on the default parameter: here DEFAULT_PARAMETER
// is implicitely used.
EventBus.say('Hello')

// Triggering an event always returns a promise
EventBus.say('michel', 'Hello').then(() => {
    ...
})

EventBus.getTime().then((time) => {
    ...
})

EventBus.multiply({a: 2, b: 5 }).then((result) => {
    ...
})

EventBus.ping()
```

```typescript
// secondModule.ts
import EventBus from "./secondModule.EventBus.ts";

// Add a listener on the default parameter
EventBus.ping.on(() => {
  console.log("pong");
});

// Or listen to a specific parameter
EventBus.say.on("michel", (words) => {
  console.log("michel said", words);
});

// Event subscribers can respond to the event synchronously (by returning a value)
EventBus.getTime.on(() => new Date().toString);

// Or asynchronously (by returning a Promise that resolves with the value).
EventBus.multiply.on(
  ({ a, b }) =>
    new Promise((resolve, reject) => {
      AsynchronousMultiplier(a, b, (err, result) => {
        if (err) {
          return reject(err);
        }
        resolve(result);
      });
    })
);
```

Calls and subscriptions on slots are typechecked

```typescript
EventBus.multiply({a: 1, c: 2}) // Compile error: property 'c' does not exist on type {a: number, b: number}

EventBus.multiply.on(({a, b}) => {
    if (a.length > 2) { // Compile error: property 'length' does not exist on type 'number'
        ...
    }
})
```

### Lazy callbacks

Slots expose a `lazy` method that will allow you to call a "connect" callback when a first
client connects to the slot, and a "disconnect" callback when the last client disconnect.

Remote or local clients are considered equally. If a client was already connected to the slot
at the time when `lazy` is called, the "connect" callback is called immediately.

```typescript
const connect = (param) => {
  console.log(
    `Someone somewhere has begun listening to the slot with .on on ${param}.`
  );
};

const disconnect = (param) => {
  console.log(`No one is listening to the slot anymore on ${param}.`);
};

const disconnectLazy = EventBus.ping.lazy(connect, disconnect);

const unsubscribe = EventBus.ping().on(() => {});
// console output: 'Someone somewhere has begun listening to the slot with .on on $_DEFAULT_$.'

unsubscribe();
// console output: 'No one is listening to the slot anymore on $_DEFAULT_$.'

const unsubscribe = EventBus.ping().on("parameter", () => {});
// console output: 'Someone somewhere has begun listening to the slot with .on on parameter.'

unsubscribe();
// console output: 'No one is listening to the slot anymore on parameter.'

// Remove the callbacks.
// "disconnect" is called one last time if there were subscribers left on the slot.
disconnectLazy();
```

### Buffering

When the eventBus is created with channels, slots will wait for all transports to have
registered callbacks before triggering.

This buffering mechanism can be disabled at the slot level with the `noBuffer` config option:

```typescript
const MyEvents = {
  willWait: slot<string>(),
  wontWait: slot<string>({ noBuffer: true }),
};
```

### Auto-reconnection

In order to re-establish a lost connection when triggering an event a `Channel`
needs to implement the `autoReconnect` method.
See example: [RuntimeConnect](./examples/channels/RuntimeConnect.ts)
It's also possible to fine tune and deactivate this feature on a per-slot basis :

```typescript
const MyEvents = {
  willAutoReconnect: slot<string>(),
  wontNotAutoReconnect: slot<string>({ autoReconnect: false }),
};
```

### Syntactic sugar

You can combine events from different sources.

```typescript
import { combineEvents } from "ts-event-bus";
import MyEvents from "./MyEvents.ts";
import MyOtherEvents from "./MyOtherEvents.ts";

const MyCombinedEvents = combineEvents(MyEvents, MyOtherEvents);

export default MyCombinedEvents;
```

## Using and Implementing Channels

`ts-event-bus` comes with an abstract class [GenericChannel](./src/Channel.ts).
To implement your own channel create a new class extending `GenericChannel`, and call the method given by the abstract class: `_connected()`, `_disconnected()`, `_error(e: Error)` and `_messageReceived(data: any)`.

Basic WebSocket Channel example:

```typescript
import { GenericChannel } from "ts-event-bus";

export class MyBasicWebSocketChannel extends GenericChannel {
  private _ws: WebSocket | null = null;
  private _host: string;

  constructor(host: string) {
    super();
    this._host = host;
    this._init();
  }

  private _init(): void {
    const ws = new WebSocket(this._host);

    ws.onopen = (e: Event) => {
      this._connected();
      this._ws = ws;
    };

    ws.onerror = (e: Event) => {
      this._ws = null;
      this._error(e);
      this._disconnected();
      setTimeout(() => {
        this._init();
      }, 2000);
    };

    ws.onclose = (e: CloseEvent) => {
      if (ws === this._ws) {
        this._ws = null;
        this._disconnected();
        this._init();
      }
    };

    ws.onmessage = (e: MessageEvent) => {
      this._messageReceived(e.data);
    };
  }
}
```

## Examples

- [Channel implementation](./examples/channels)
- [Usage](./examples/usage)
