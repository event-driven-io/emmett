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

<<< @/snippets/gettingStarted/shoppingCart.ts#getting-started-state

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

```ts
const currentState = events.reduce<State>(evolve, getInitialState());
```

For our case initial state can look like:

<<< @/snippets/gettingStarted/shoppingCart.ts#getting-started-state-default

Now let's define the `evolve` function that will evolve our state based on events:

<<< @/snippets/gettingStarted/shoppingCart.ts#getting-started-state-evolve

Read also more in article [How to get the current entity state from events?]() and follow up on [Should you throw an exception when rebuilding the state from events?](https://event-driven.io/en/should_you_throw_exception_when_rebuilding_state_from_events/).

## Unit Testing

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

## Command Handling

**As you saw in [the unit tests example](#testing), Event Sourcing brings a repeatable pattern for handling business logic.** We can expand that to application logic.

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

You could put such code, e.g. in your WebApi endpoint. Let's go to the next step and use that in practice in the real web application.

## Application Setup

Seems like we have our business rules modelled, business logic reflected in code, and even tested. You also know how to write application code for handling commands. Isn't that cool? That's nice, but we need to build real applications, which nowadays typically mean a Web Application. Let's try to do it as well.

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

### Application setup

Emmett provides the _getApplication_ method that sets up the recommended configuration of the Express.js application. By calling it, you'll get:

1. **JSON and Url Encoding middlewares** set up needed for WebApi request processing,
2. **Problem details middleware.** Why reinvent the wheel if there's now an industry standard for handling error responses? See [RFC 9457 - Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)) - we're implementing it for you out of the box. We've also set up a basic error-to-status mapping convention. For instance, for Emmett built-in error types:

   - `ValidationError` to `400`,
   - `IllegalStateError` to `403`,
   - `NotFoundError` to `404`,
   - `ConcurrencyError` to `412`.

   You can also customise that and provide your custom mapping.

3. Default setup for [using ETag headers for optimistic concurrency](https://event-driven.io/en/how_to_use_etag_header_for_optimistic_concurrency/).
4. Unified way of setting up WebApis via providing a set of router configurations.

Of course, you can disable all of that or use your current setup. All of that is optional for Emmett to work. We just want to make things easier for you and help you speed up your development using industry standards. We prefer composition over replacement.

### Starting Application

The `startAPI` method encapsulates the default startup options like the default port (in Emmett's case, it's `3000`). A separate `startAPI` method allows you to customise the default application setup and makes it easier to run integration tests, as you'll see in a moment.

### Router configuration

To configure API, we need to provide router configuration. We can do it via the `apis` property of the `getApplication` options. WebApi setup is a simple function that takes the router and defines needed routings on it.

<<< @./../packages/emmett-expressjs/src/application.ts#web-api-setup

We recommend providing different web app configurations for different endpoints' logical groupings. It's also worth injecting all needed dependencies from the top, as that will make integration testing easier.

That's what we did in our case. We've set up our Shopping Carts API and injected external dependencies:

- event store to store and retrieve events,
- The `getUnitPrice` method represents a call to an external service to get the price of a product added to the shopping cart,
- We're also passing the current date generator. Embracing this non-deterministic dependency will be helpful for integration testing later on.

That clearly explains what dependencies this API needs, and by reading the file, you can understand what your application technology needs. That should cut the onboarding time for new people grasping our system setup.

<<< @/snippets/gettingStarted/webApi/apiSetup.ts#getting-started-api-setup

We're using the simplest option for this guide: an in-memory event store. For a real application, you'd need to use another, e.g. EventStoreDB implementation.

Sounds like we have all the building blocks to define our API; let's do it!

## WebAPI definition

Let's define our Shopping Cart WebApi. As mentioned before, we'll need two external dependencies: event store and query for product price:

<<< @/snippets/gettingStarted/webApi/shoppingCartApiSetup.ts#getting-started-api-setup

The API definition is a function taking external dependencies and returning the Web API setup. We're also setting up [Command Handler (as explained in the previous section)](#command-handling). Let's not keep it empty for too long and define our first endpoint!

We'll start with adding product items to the shopping cart and _vanilla_ Express.js syntax.

<<< @/snippets/gettingStarted/webApi/shoppingCartEndpointVanilla.ts#getting-started-vanilla-router

::: info Web Api Command Handling can be described by the following steps:

1. **Translate and request params to the command.** This is also a place to run necessary validation. Thanks to that, once we created our command, we can trust that it's validated and semantically correct. We don't need to repeat that in the business logic. That reduces the number of IFs and, eventually, the number of unit tests.
2. **Run command handler on top of business logic.** As you see, we keep things explicit; you can still run _Go to definition_ in your IDE and understand what's being run. So we're keeping things that should be explicit, explicit and hiding boilerplate that can be implicit.
3. **Return the proper HTTP response.**

:::

As you see, it's just a regular Express.js syntax. Still, in the longer term, it's better to have a way to make it a more scalable approach and unify intended usage patterns. That's what we're here for, right?

In Emmett, you can define it also like that:

<<< @/snippets/gettingStarted/webApi/shoppingCartEndpointWithOn.ts#getting-started-on-router

`on` is a simple wrapper:

<<< @./../packages/emmett-expressjs/src/handler.ts#httpresponse-on

But this simplicity is powerful as:

- it makes code more explicit on what we have as input and what is output. Emmett also defines the explicit signatures for the most common
- unifies request processing, which should enable better handling of telemetry, logging, OpenApi, etc.
- enables keeping endpoint handlers even in different files, so enables organisation,
- you could even unit test it without running the whole application.

If you still don't buy that, check a more advanced scenario showing a different flow, where shopping cart opening should happen explicitly:

<<< @./../packages/emmett-expressjs/src/e2e/decider/api.ts#created-example

**Yes, Emmett provides more built-in response helpers together with the explicit options.** Created will generate the location header. If you're returning the error status (e.g. `404 Not Found`), you can add problem details, information, etc.

**What's also sweet is that you can use Emmett's Express.js helpers even without an Event Sourcing code; Bon Appétit!**

Still, we're here for the Event Sourcing, so let's see the whole API:

<<< @/snippets/gettingStarted/webApi/simpleApi.ts#complete-api

Of course, we could make it even crisper and automagically do the request mapping, more conventional-based status resolution, decorators, and fire-command-and-forget, but we won't. Why?

**Emmett prefers composability over magical glue.** We believe that a healthy amount of copy-paste won't harm you. We target removability and segregation of the code and making things explicit that should be explicit.

**Still, Emmett won't tell you how to live!** If you want to add more, feel free to do it. We want to give you basic building blocks and recommendations so you can build on top of that!

## Integration Testing

Cool, we now have API up and running. We even tested our [domain logic with unit tests](#unit-testing). That's great, but as you know, a lot can happen in the meantime. The request mapping or validation may fail; middlewares (like auth one) can say no. It'd be great to test it.

There are many different shapes of Testing: [Pyramids](https://martinfowler.com/articles/practical-test-pyramid.html), [Honeycombs](https://engineering.atspotify.com/2018/01/testing-of-microservices/), [Thropies](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications) etc. All of them share the goal of having them reliable and fast. However, agreeing on where the compromise is and where to put the biggest effort is, of course, challenging to agree.

No matter what your preference is, Emmett has got you covered.

**Let's say that you're a fan of [Hexagonal/Ports & Adapters Architecture](https://jmgarridopaz.github.io/content/hexagonalarchitecture.html) and you'd like to test the whole flow being able to replace dependencies (adapters) with in-memory implementations to have your tests running in-memory.** Such approaches have tradeoffs. The pros are that they run smoothly, allow a fast feedback loop, and run tests continuously. The downside is that they don't validate all integration scenarios with real tools. Don't worry, we'll cover that later!

I heard that one picture could speak more than a thousand words, so let's look at this one:

![hexagon](hexagon.png)

**The picture shows the boundaries between the business logic and our application layer.**

Our application layer is thin; it's a vertical slice to which the entry point (port) is the WebApi endpoint. Inside it, we can do additional stuff like getting product prices and mapping requests with additional data added to the command. We handle commands in the business logic that return event(s). We're storing them in the event store. This looks like that in the already known adding product to shopping cart code:

<<< @/snippets/gettingStarted/webApi/addProductVerticalSlice.ts#vertical-slice

**Our slice has 3 ports that one can plug in:**

1. WebApi endpoint, where the user can send a request (which will be translated to a command).
2. `getUnitPrice` function that gets the product price. Depending on our design, it may represent a call to an external service (e.g. with HTTP), calling a database (e.g. read model) or just running some computation. We're also using it as an input to the command.
3. Event store, from which we load events and store new facts.

We already made those dependencies explicit, allowing us to replace the real ones inside the tests. Also, as we know that we're doing Event Sourcing then, why not take advantage of that and write our tests in the following style:

::: tip

- **GIVEN** set of events recorded for the entity,
- **WHEN** we run the web API request,
- **THEN** we’re getting new event(s) as a result of business logic. Or the error status is returned with Problem Details.

:::

Let's start with defining our WebApi specification. We're using `ApiSpecification` class from `@event-driven-io/emmett-expressjs`.

<<< @/snippets/gettingStarted/webApi/apiBDDIntGiven.ts#given

We're also using the same [`getApplication` known from the previous steps](#application-setup). The only difference is that we replaced real dependencies with the in-memory ones. `ApiSpecification` uses internally [SuperTest package](https://www.npmjs.com/package/supertest). It allows straightforward testing of Express.js, e.g. it ensures that server starts in a random port and provides the helpers for building test requests, which we'll use in our tests.

Having it, we can define our tests as:

<<< @/snippets/gettingStarted/webApi/apiBDDIntTest.ts#test

The test follows the similar Given/When/Then pattern as our unit tests but uses HTTP request to trigger the command handling and uses additional helpers to set up and verify data:

- `exisitingStream` - allows you to specify the stream id and events existing in the stream. You can set more than one stream if your command handling logic requires that,
- `expectResponse` - verifies the HTTP response with expected criteria like status code. You can also check the response body, headers, etc. For expected errors you can use `expectError` accordingly.
- `expectEvents` - ensures that new events are appended to the specific streams in the event store.

Complete tests will look like this:

<<< @/snippets/gettingStarted/webApi/apiBDD.int.spec.ts#getting-started-integration-tests

You can use those tests as complementary to the business logic (e.g., testing the most important scenarios), or you may even replace unit tests with them. As they're in memory, they're fast enough to be run continuously.

You can also replace the in-memory store with the real one (e.g. EventStoreDB) and test your module in isolation from other modules. The choice is yours!

Again, in Emmett, we don't want to force you to anything but give you options and the recommended safe path.

::: tip

We encourage you to watch Martin Thwaites' talk ["Building Operable Software with TDD (but not the way you think)"](https://www.youtube.com/watch?v=prLRI3VEVq4). It nicely explains why we can now shift the balance from unit testing to integration testing.

:::
