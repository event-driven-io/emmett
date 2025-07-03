---
documentationType: user-guide
---

# Getting Started

![Emmett logo](/logo.png)

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

We're using [Event type](/api-reference/event), which helps to keep the event definition aligned. It's not a must, but it helps to ensure that it has a type name defined (e.g. `ProductItemAddedToShoppingCart`) and read-only payload data.

## Commands

We need to provide a clear business intention to capture a meaningful business event. We can declare it by defining the set of commands to tell what business logic we'll be handling:

<<< @/snippets/gettingStarted/commands.ts#getting-started-commands

Accordingly, to define the event, we're using the [`Command` type](/api-reference/command), ensuring that our type definition is aligned. Using the `Command` type is optional, as Emmett won't force you to use any marker types, but with [TypeScript structural typing](https://event-driven.io/en/structural_typing_in_type_script/), this is quite useful to align the type definition.

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
const currentState = events.reduce<State>(evolve, initialState());
```

For our case initial state can look like:

<<< @/snippets/gettingStarted/shoppingCart.ts#getting-started-state-default

Now let's define the `evolve` function that will evolve our state based on events:

<<< @/snippets/gettingStarted/shoppingCart.ts#getting-started-state-evolve

Read also more in article [How to get the current entity state from events?](https://event-driven.io/en/how_to_get_the_current_entity_state_in_event_sourcing/) and follow up on [Should you throw an exception when rebuilding the state from events?](https://event-driven.io/en/should_you_throw_exception_when_rebuilding_state_from_events/).

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

It brings you three most important methods:

- `readStream` - reads events for the specific stream. By default, it reads all events, but through options, you can specify the event range you want to get (`from`, `to`, `maxCount`). You can also specify the expected stream version.
- `appendToStream` - appends new events at the end of the stream. All events should be appended as an atomic operation. You can specify the expected stream version for an [optimistic concurrency check](https://event-driven.io/en/optimistic_concurrency_for_pessimistic_times/). We're also getting the next stream version as a result.
- `aggregateStream` - builds the current state from events. Internally, event store implementation should read all events in the stream based on the passed initial state and the `evolve` function. It also supports all the same options as the `readStream` method.

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
    initialState,
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
$ pnpm add @event-driven-io/emmett-expressjs
```

```sh [yarn]
$ yarn add @event-driven-io/emmett-expressjs
```

```sh [bun]
$ bun add @event-driven-io/emmett-expressjs
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

We're using the simplest option for this guide: an in-memory event store. For a real application, you'd need to use another, e.g. PostgreSQL implementation.

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

![hexagon](/hexagon.png)

**The picture shows the boundaries between the business logic and our application layer.**

Our application layer is thin; it's a vertical slice to which the entry point (port) is the WebApi endpoint. Inside it, we can do additional stuff like getting product prices and mapping requests with additional data added to the command. We handle commands in the business logic that return event(s). We're storing them in the event store. This looks like that in the already known adding product to shopping cart code:

<<< @/snippets/gettingStarted/webApi/addProductVerticalSlice.ts#vertical-slice

**Our slice has 3 ports that one can plug in:**

1. **WebApi endpoint**, where the user can send a request (which will be translated to a command).
2. **`getUnitPrice` function** that gets the product price. Depending on our design, it may represent a call to an external service (e.g. with HTTP), calling a database (e.g. read model) or just running some computation. We're also using it as an input to the command.
3. **Event store**, from which we load events and store new facts.

We already made those dependencies explicit, allowing us to replace the real ones in the tests. Also, as we know that we're doing Event Sourcing then, why not take advantage of that and write our tests in the following style:

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

You can also replace the in-memory store with the real one (e.g. PostgreSQL) and test your module in isolation from other modules. The choice is yours!

Again, in Emmett, we don't want to force you to anything but give you options and the recommended safe path.

::: tip

We encourage you to watch Martin Thwaites' talk ["Building Operable Software with TDD (but not the way you think)"](https://www.youtube.com/watch?v=prLRI3VEVq4). It nicely explains why we can now shift the balance from unit testing to integration testing.

:::

## Making it real

See, we now have a fully working and tested web application. We can send requests, handle business logic, cool! Yet, we're missing a few steps to make it production-ready. Using an in-memory implementation is fine for prototyping, but you wouldn't want your data to disappear when the application restarts, would you?

Let's start by adding more flavour and finally use a real database! Which one? The common answer nowadays is: "[Just use PostgreSQL!](https://www.amazingcto.com/postgres-for-everything/)", and that's what we're going to do!

We need to start by installing Emmett's PostgreSQL package:

::: code-group

```sh [npm]
$ npm add @event-driven-io/emmett-postgresql
```

```sh [pnpm]
$ pnpm add @event-driven-io/emmett-postgresql
```

```sh [yarn]
$ yarn add @event-driven-io/emmett-postgresql
```

```sh [bun]
$ bun add @event-driven-io/emmett-postgresql
```

:::

Now, we need to switch the in-memory implementation to PostgreSQL in the WebApi setup. Updated will look as follows:

<<< @/snippets/gettingStarted/webApi/apiSetupWithPostgreSQL.ts#getting-started-api-setup

It's as simple as that; we're injecting just a different implementation.

::: info **Emmett provides you with out-of-the-box support for the following storage:**

- **PostgreSQL** with [emmett-postgresql](https://www.npmjs.com/package/@event-driven-io/emmett-postgresql) package,
- **EventStoreDB** with [emmett-esdb](https://www.npmjs.com/package/@event-driven-io/emmett-esdb) package,
- **MongoDB** with [emmett-mongodb](https://www.npmjs.com/package/@event-driven-io/emmett-mongodb) package,
- **SQLite** with [emmett-sqlite](https://www.npmjs.com/package/@event-driven-io/emmett-sqlite) package,
- **In-Memory** with regular [emmett](https://www.npmjs.com/package/@event-driven-io/emmett) package.

We encourage you to select the one that you prefer; the setup will be similar. You simply need to install a specific package and set up a chosen event store accordingly.

Read more about how event stores are built in the [article](https://event-driven.io/en/lets_build_event_store_in_one_hour/).

:::

We're also missing one more essential aspect...

## Read Models

**In Event Sourcing, we rebuild state by reading all events in a stream. That's fast for one shopping cart - maybe 10-50 events. But showing a list of all shopping carts?** If we tried to build it in memory, as we did for business logic, on the flight, we'd need to read events from potentially thousands of streams. Then rebuild each cart's state in memory, and filter them. Every page load would process hundreds of thousands of events.

In our systems, most operations are queries. We need them to be performant and efficient. To do that, we need to materialise our data into read models.

In Event Sourcing, that means applying our events and storing the result in database tables. Then we can filter, sort, and search efficiently. Projections are event handlers that update these tables when events happen.

### Single Stream Projections with Pongo

We could store our read models in PostgreSQL tables. Create columns for each field. Write UPDATE statements. Handle migrations when fields change. Map document structures to relational schemas.

That's why we have Pongo. It stores documents as JSONB in PostgreSQL - structured data that PostgreSQL can index and query, not just text blobs. You can use powerful MongoDB-like query syntax.

If you followed the PostgreSQL setup earlier, you already have Pongo installed (it comes as a peer dependency with `@event-driven-io/emmett-postgresql`).

Let's say that we want to show the summary of the shopping cart, showing just the total items count and amount. This could be used, e.g., in the top menu bar, to give users quick feedback. It could be defined as:

```ts
type ShoppingCartSummary = {
  _id?: string;
  productItemsCount: number;
  totalAmount: number;
};
```

Now, let's define how we'd like to apply those events. The `evolve` function takes the current document state and an event, then returns the updated state:

```ts
const evolve = (
  document: ShoppingCartSummary | null,
  {
    type,
    data: event,
  }: ProductItemAdded | ProductItemRemoved | DiscountApplied,
): ShoppingCartSummary => {
  document = document ?? { totalAmount: 0, productItemsCount: 0 };

  switch (type) {
    case 'ProductItemAdded':
      return withAdjustedTotals({
        document,
        productItem: event.productItem,
        by: 'adding',
      });
    case 'ProductItemRemoved':
      return withAdjustedTotals({
        document,
        productItem: event.productItem,
        by: 'removing',
      });
    case 'DiscountApplied':
      return {
        ...document,
        totalAmount: (document.totalAmount * (100 - event.percent)) / 100,
      };
  }
};

const withAdjustedTotals = (options: {
  document: ShoppingCartSummary;
  productItem: PricedProductItem;
  by: 'adding' | 'removing';
}) => {
  const { document, productItem, by } = options;
  const plusOrMinus = by === 'adding' ? 1 : -1;

  return {
    ...document,
    totalAmount:
      document.totalAmount +
      productItem.unitPrice * productItem.quantity * plusOrMinus,
    productItemsCount:
      document.productItemsCount + productItem.quantity * plusOrMinus,
  };
};
```

As you see, the transformation may not need to handle all event types. We don't need to know the status (whether it's confirmed or not); we just need information about totals.

The next step is to define our Pongo projection. We do it by:

```ts
import { pongoSingleStreamProjection } from '@event-driven-io/emmett-postgresql';

const collectionName = 'shopping_carts_summary';

const shoppingCartSummaryProjection = pongoSingleStreamProjection({
  canHandle: ['ProductItemAdded', 'ProductItemRemoved', 'DiscountApplied'],
  collectionName,
  evolve,
});
```

By that we're handling the specified range of events, applying it using the evolve function and storing the result in the specified Pongo collection. Pongo collections are PostgreSQL tables with a JSONB column for your document data.

Notice something? We didn't touch our business logic. We're interpreting events that already happened. Tomorrow, you might need a different view of the same data - just create a new projection.

If you don't like getting a null document in the evolve function, then you can also provide the initial state:

```ts
const shoppingCartSummaryProjection = pongoSingleStreamProjection({
  canHandle: ['ProductItemAdded', 'ProductItemRemoved', 'DiscountApplied'],
  collectionName,
  evolve,
  initialState: () => ({ totalAmount: 0, productItemsCount: 0 }),
});
```

Then your evolve can skip the setup step and look as follows:

```ts
const evolve = (
  document: ShoppingCartSummary,
  {
    type,
    data: event,
  }: ProductItemAdded | ProductItemRemoved | DiscountApplied,
): ShoppingCartSummary => {
  switch (type) {
    case 'ProductItemAdded':
      return withAdjustedTotals({
        document,
        productItem: event.productItem,
        by: 'adding',
      });
    case 'ProductItemRemoved':
      return withAdjustedTotals({
        document,
        productItem: event.productItem,
        by: 'removing',
      });
    case 'DiscountApplied':
      return {
        ...document,
        totalAmount: (document.totalAmount * (100 - event.percent)) / 100,
      };
  }
};
```

Emmett will provide the initial state if the document with id equal to the stream name doesn't exist.

**We need to complete registration by passing it to event store options:**

```ts
const eventStore = getPostgreSQLEventStore(connectionString, {
  projections: projections.inline([shoppingCartSummaryProjection]), // 👈
});
```

**Inline registration means that projections run in the same database transaction as appending events.** Either both succeed or both fail. No inconsistency between your events and read models. Of course, you need to be careful with them, as they can slow your appends, but they're really useful. Async projections are also available; we'll document them soon.

Sounds cool; now we can append a few events through regular event store append events api and query results using Pongo:

```ts
import { pongoClient } from '@event-driven-io/pongo';

const connectionString =
  process.env.POSTGRESQL_CONNECTION_STRING ??
  'postgresql://localhost:5432/postgres';

const pongo = pongoClient(connectionString);

const shoppingCartsSummary = pongo.db().collection('shopping_carts_summary');

const summary = await shoppingCartsSummary.findOne({
  _id: 'shopping_cart-123',
});
```

That's single-stream projection - one stream to one document.

### Multi-Stream Projections

So far, each shopping cart had its own stream of events, and we created one summary document per cart. The document ID matched the stream ID. Simple.

But businesses need customer-level analytics. Total spent across all their carts. Number of abandoned versus confirmed carts. Average cart value. This data comes from multiple shopping cart streams, not just one.

What if we'd like to have the read model that aggregates the general summary of client's pending, confirmed and cancelled shopping carts? It could be defined as:

```ts
export type ClientShoppingSummary = {
  clientId: string;
  pending: PendingSummary | undefined;
  confirmed: ConfirmedSummary;
  cancelled: CancelledSummary;
};

export type ShoppingSummary = {
  productItemsCount: number;
  totalAmount: number;
};

export type PendingSummary = ShoppingSummary & {
  cartId: string;
};

export type ConfirmedSummary = ShoppingSummary & {
  cartsCount: number;
};

export type CancelledSummary = ShoppingSummary & {
  cartsCount: number;
};
```

It contains the pending shopping cart information (if there's such a thing) plus the total number of confirmed and cancelled shopping carts, their total amounts, and total product item counts.

**The id of our read model is equal to the client id. Every client will have a single summary.**

To build this read model, we need to correlate events with respective records. We'll be applying events sequentially. We need to know which record they need to update. If our read model id is equal to the client id, then best if we have the client id in events. But besides the Product Item Added event, we don't.

Of course, we could reconsider adding it to all the events, but we already discussed that we would not necessarily like to. So what should we do?

**We could query some other read model (e.g. shopping cart details) and load the client id, but then we'd have an even worse problem.** Tying those two models together and decreasing scaling and isolation.

**Still, if we think that business-wise, data should always be there, then we could use event metadata.** Events have two parts: data (the business facts) and metadata (context like who, when, where). Metadata is typically used for infrastructure concerns - correlation IDs, timestamps, user IDs. But if needed, projections can read it too. That's always a steep hill, and you better be careful not to make metadata a "bag for random data." This definitely can be a hidden trap. There are no hard rules here, but some good heuristics.

**We can look at our endpoints and commands that initiate business logic, resulting in events.** For instance, if we look at:

```
POST /clients/:clientId/shopping-carts/current/product-items

DELETE /clients/:clientId/shopping-carts/current/product-items

POST /clients/:clientId/shopping-carts/current/confirm

DELETE /clients/:clientId/shopping-carts/current

GET /clients/:clientId/shopping-carts/current
```

Then, we see that all of them are in the current shopping cart context and the specific client. That can lead to the conclusion that we already have this client context in our requests. Maybe it's used for authorisation, maybe for tenancy reasons.

If that's not visible in endpoints, we can check on our authorisation rules and middleware. They typically need some data based on the currently authenticated user.

Having that, we could consider making the client id a part of the shopping cart event metadata. As we now have the client ID in metadata, we could use it for the event to read model correlation. For instance:

```ts
const clientShoppingSummaryCollectionName = 'ClientShoppingSummary';

export const clientShoppingSummaryProjection = pongoMultiStreamProjection({
  collectionName: clientShoppingSummaryCollectionName,
  // 👇 See what we did here
  getDocumentId: (event) => event.metadata.clientId,
  evolve,
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
});
```

We're saying that to find the document ID for each shopping cart event, you can use _event.metadata.clientId_.

Then, the projection definition can look as follows:

```ts
const evolve = (
  document: ClientShoppingSummary | null,
  { type, data: event, metadata }: ShoppingCartEvent,
): ClientShoppingSummary | null => {
  const summary: ClientShoppingSummary = document ?? {
    clientId: metadata!.clientId,
    pending: undefined,
    confirmed: initialSummary,
    cancelled: initialSummary,
  };

  switch (type) {
    case 'ProductItemAddedToShoppingCart':
      return {
        ...summary,
        pending: {
          cartId: event.shoppingCartId,
          ...withAdjustedTotals({
            summary: summary.pending,
            with: event.productItem,
            by: 'adding',
          }),
        },
      };
    case 'ProductItemRemovedFromShoppingCart':
      return {
        ...summary,
        pending: {
          cartId: event.shoppingCartId,
          ...withAdjustedTotals({
            summary: summary.pending,
            with: event.productItem,
            by: 'removing',
          }),
        },
      };
    case 'ShoppingCartConfirmed':
      return {
        ...summary,
        pending: undefined,
        confirmed: {
          cartsCount: summary.confirmed.cartsCount + 1,
          ...withAdjustedTotals({
            summary: summary.confirmed,
            with: summary.pending!,
            by: 'adding',
          }),
        },
      };
    case 'ShoppingCartCancelled':
      return {
        ...summary,
        pending: undefined,
        cancelled: {
          cartsCount: summary.confirmed.cartsCount + 1,
          ...withAdjustedTotals({
            summary: summary.confirmed,
            with: summary.pending!,
            by: 'adding',
          }),
        },
      };
    default:
      return summary;
  }
};

const initialSummary = {
  cartsCount: 0,
  productItemsCount: 0,
  totalAmount: 0,
};

const withAdjustedTotals = (options: {
  summary: ShoppingSummary | undefined;
  with: PricedProductItem | ShoppingSummary;
  by: 'adding' | 'removing';
}) => {
  const { summary: document, by } = options;

  const totalAmount =
    'totalAmount' in options.with
      ? options.with.totalAmount
      : options.with.unitPrice * options.with.quantity;
  const productItemsCount =
    'productItemsCount' in options.with
      ? options.with.productItemsCount
      : options.with.quantity;

  const plusOrMinus = by === 'adding' ? 1 : -1;

  return {
    ...document,
    totalAmount: (document?.totalAmount ?? 0) + totalAmount * plusOrMinus,
    productItemsCount:
      (document?.productItemsCount ?? 0) + productItemsCount * plusOrMinus,
  };
};
```

We also need to register our projection registration in event store options:

```ts
const eventStore = getPostgreSQLEventStore(connectionString, {
  projections: projections.inline([
    shoppingCartSummaryProjection,
    clientShoppingSummaryProjection, // 👈
  ]),
});
```

### When to Use Which?

**Single-stream projections** work when your read model represents one entity. Shopping cart summary. Order details. User profile. The document ID is the stream ID.

**Multi-stream projections** combine events from different streams into a single document. Customer analytics from all their orders. Product statistics from all carts. System-wide dashboards. You tell the projection how to find the right document for each event.

Think about your queries. If you're showing one cart, use single-stream. If you're showing customer behavior, use multi-stream.

### Testing projections

**Projection tests should be tested against the real database.** Both querying and update capabilities and serialisation can play tricks, so it is better to be certain that it really works. Tests that don't give us such assurance are useless. And we don't want them to be such.

As PostgreSQL is a real database, we need to set it up for our tests. The simplest option is to use a Docker container. You can do it in multiple ways, but the fastest can be using [TestContainers](https://node.testcontainers.org/). The library allows us to easily set up containers for our tests. It automatically randomise ports, helps in teardown etc.

For PostgreSQL you'll need to install:

::: code-group

```sh [npm]
$ npm add @testcontainers/postgresql
```

```sh [pnpm]
$ pnpm add @testcontainers/postgresql
```

```sh [yarn]
$ yarn add @testcontainers/postgresql
```

```sh [bun]
$ bun add @testcontainers/postgresql
```

::: info EventStoreDB testing

Emmett provides the package with additional test containers like the one for [EventStoreDB](https://developers.eventstore.com/). If you're using EventStoreDB, install [emmett-testcontainers](https://www.npmjs.com/package/@event-driven-io/emmett-testcontainers) and get the test container for it.

:::

Now, let's start with the setup:

```ts
import { PostgreSQLProjectionSpec } from '@event-driven-io/emmett-postgresql';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';

void describe('Shopping carts summary', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let given: PostgreSQLProjectionSpec<
    ProductItemAdded | ProductItemRemoved | DiscountApplied
  >;
  let shoppingCartId: string;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();

    given = PostgreSQLProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      connectionString,
    });
  });

  beforeEach(() => (shoppingCartId = `shoppingCart-${uuid()}`));
});
```

We're setting up the PostgreSQL test container and projection specification. We'll use it to run our tests. The first one could look as follows:

```ts
import { expectPongoDocuments } from '@event-driven-io/emmett-postgresql';

void describe('Shopping carts summary', () => {
  // (...) test setup

  void it('first added product creates document', () =>
    given([])
      .when([
        {
          type: 'ProductItemAddedToShoppingCart',
          data: {
            productItem: { unitPrice: 100, productId: 'shoes', quantity: 100 },
          },
          metadata: {
            streamName: shoppingCartId,
          },
        },
      ])
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartSummary>('shopping_carts_summary')
          .withId(shoppingCartId)
          .toBeEqual({
            productItemsCount: 100,
            totalAmount: 10000,
            appliedDiscounts: [],
          }),
      ));
});
```

We're again using theBehaviour-Driven Design style:

- **Given** existing stream of events,
- **When** new events are added,
- **Then** read model is updated.

We do it this way, as we expect read models to be ONLY updated through upcoming events.

Emmett gives you also out-of-the-box test assertion helpers to make testing Pongo easier.

You may have noticed that our Given is empty, so let's fix it!

```ts
import {
  eventsInStream,
  newEventsInStream,
} from '@event-driven-io/emmett-postgresql';

void describe('Shopping carts summary', () => {
  // (...) test setup

  void it('applies discount for existing shopping cart with product', () => {
    const couponId = uuid();

    return given(
      eventsInStream(shoppingCartId, [
        {
          type: 'ProductItemAddedToShoppingCart',
          data: {
            productItem: { unitPrice: 100, productId: 'shoes', quantity: 100 },
          },
        },
      ]),
    )
      .when(
        newEventsInStream(shoppingCartId, [
          {
            type: 'DiscountApplied',
            data: { percent: 10, couponId },
          },
        ]),
      )
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartShortInfo>(
            shoppingCartShortInfoCollectionName,
          )
          .withId(shoppingCartId)
          .toBeEqual({
            productItemsCount: 100,
            totalAmount: 9000,
          }),
      );
  });
});
```

You probably noticed the next helpers: _eventsInStream_ and _newEventsInStream_. They're responsible for shortening the setup. Depending on your preferences, you can use the raw events setup, including manual metadata assignment, or a more explicit intention helper. My preference would be to use the helper, but it's up to you to decide!

### Deleting documents

**Can read model data be only updated? Not only that, you can also delete it.** Let's imagine that the confirming cart should clear its read model, as we expect a new, empty shopping cart to be created when the new buying process starts.

To have that, we need to update our evolve function by adding _ShopingCartConfirmed_ event:

```ts
const evolve = (
  document: ShoppingCartSummary,
  { type, data: event }: ShoppingCartEvent,
): ShoppingCartSummary | null => {
  // <= see here
  switch (type) {
    case 'ProductItemAdded':
      return withAdjustedTotals({
        document,
        productItem: event.productItem,
        by: 'adding',
      });
    case 'ProductItemRemoved':
      return withAdjustedTotals({
        document,
        productItem: event.productItem,
        by: 'removing',
      });
    case 'DiscountApplied':
      return {
        ...document,
        totalAmount: (document.totalAmount * (100 - event.percent)) / 100,
      };

    case 'ShoppingCartConfirmed':
      return null; // <= and here
  }
};
```

We made the shopping cart confirmed event return null. In Pongo, returning null means "delete this document." Emmett is using the Pongo's _handle_ method internally:

```typescript
const collection = pongo.db().collection<Document>(collectionName);

for (const event of events) {
  await collection.handle(getDocumentId(event), async (document) => {
    return await evolve(document, event);
  });
}
```

Pongo's handle method loads the document if it exists, runs your function, then:

- If you return a document, it inserts or updates
- If you return null, it deletes
- All in one atomic operation

It's a bit sneaky, but pretty useful, isn't it?

This flexibility is Event Sourcing at work. Events stay immutable. Projections interpret them however they need. Changed your mind about when to delete documents? Update the projection and rebuild from events.

The test checking will look as follows:

```ts
void describe('Shopping carts summary', () => {
  let given: PostgreSQLProjectionSpec<ShoppingCartEvent>;
  // (...) test setup

  void it('confirmed event removes read mode for shopping cart with applied discount', () => {
    const couponId = uuid();

    return given(
      eventsInStream(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { unitPrice: 100, productId: 'shoes', quantity: 100 },
          },
        },
        {
          type: 'DiscountApplied',
          data: { percent: 10, couponId },
        },
      ]),
    )
      .when(
        newEventsInStream(shoppingCartId, [
          {
            type: 'ShoppingCartConfirmed',
            data: { confirmedAt: new Date() },
          },
        ]),
      )
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartShortInfo>(
            shoppingCartShortInfoCollectionName,
          )
          .withId(shoppingCartId)
          .notToExist(), // <= see this
      );
  });
});
```

The pattern looks the same, but the assertion is different.

**I hope that this shows you how powerful the combination of Emmett, Pongo, and PostgreSQL is.** We want to give you certainty and trust in the software you're building. Having built-in support for tests should help you with that.

### Querying Read Models in the Web API

Now that we have projections running, let's make them available through our API. Update your shopping cart API setup to include Pongo:

```ts
export const shoppingCartApi =
  (
    eventStore: EventStore,
    pongo: PongoClient,
    getUnitPrice: (productId: string) => Promise<number>,
  ): WebApiSetup =>
  (router: Router) => {
    const handle = CommandHandler(shoppingCartHandlers, eventStore);
    const shoppingCartsSummary = pongo
      .db()
      .collection<ShoppingCartSummary>('shopping_carts_summary');

    // ... existing endpoints for commands ...

    // Get shopping cart summary
    router.get(
      '/clients/:clientId/shopping-carts/:shoppingCartId/summary',
      on(async (request: Request) => {
        const shoppingCartId = assertNotEmptyString(
          request.params.shoppingCartId,
        );

        const summary = await shoppingCartsSummary.findOne({
          _id: shoppingCartId,
        });

        if (!summary) {
          return notFound({ detail: 'Shopping cart not found' });
        }

        return ok(summary);
      }),
    );

    // List all shopping carts with filters
    router.get(
      '/clients/:clientId/shopping-carts',
      on(async (request: Request) => {
        const minAmount = request.query.minAmount
          ? parseFloat(request.query.minAmount as string)
          : undefined;

        const query = minAmount ? { totalAmount: { $gte: minAmount } } : {};

        const carts = await shoppingCartsSummary.find(query).toArray();

        return ok({ carts });
      }),
    );
  };
```

Remember to inject Pongo when setting up your API:

```ts
import { pongoClient } from '@event-driven-io/pongo';

const connectionString =
  process.env.POSTGRESQL_CONNECTION_STRING ??
  'postgresql://localhost:5432/postgres';

const pongo = pongoClient(connectionString);

const eventStore = getPostgreSQLEventStore(connectionString, {
  projections: projections.inline([
    shoppingCartSummaryProjection,
    clientShoppingSummaryProjection,
  ]),
});

const application = getApplication({
  apis: [
    shoppingCartApi(
      eventStore,
      pongo, // 👈
      getUnitPrice,
    ),
  ],
});
```

## End-to-End Testing

Now, let met show you the final bit, so running end-to-end tests treating the WebApi as a black box.

Let's start with setting up our TestContainer again:

<<< @/snippets/gettingStarted/webApi/apiBDDE2EGiven.ts#test-container

::: info Event store lifetime

The PostgreSQL event store creates an internal connection pool to use PostgreSQL efficiently. **Because of that, we recommend using a single event store instance per application.** The same advice applies to other storages.

After the application ends or tests are finished, we need to close it to gracefully release open connections in the connection pool.

:::

And create our test specification using the `ApiE2ESpecification` type:

<<< @/snippets/gettingStarted/webApi/apiBDDE2EGiven.ts#given

The test will look [accordingly to the integration tests](#integration-testing), with the distinction that we also use HTTP requests for the setup. We're also checking only responses; we treat the WebApi as a black box.

<<< @/snippets/gettingStarted/webApi/apiBDDE2ETest.ts#test

Complete tests will look like this:

<<< @/snippets/gettingStarted/webApi/apiBDD.e2e.spec.ts#getting-started-e2e-tests

Check also the [full sample in Emmett repository](https://github.com/event-driven-io/emmett/tree/main/samples/webApi/expressjs-with-postgresql).
