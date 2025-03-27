# Overview

Welcome to Emmett's documentation!

![Emmett logo](/logo.png)

## What is Emmett?

**Emmett is an opinionated yet flexible framework that implements Event Sourcing for Node.js applications.** It focuses on composition rather than magic, providing lightweight abstractions and clear patterns that make Event Sourcing accessible and maintainable.

## Main Features

| Feature                           | Description                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| **Event-Centric Modeling**        | Structured approach to modeling business processes through events                     |
| **Multiple Event Stores**         | Built-in support for PostgreSQL, EventStoreDB, MongoDB, SQLite, and In-Memory storage |
| **Command Handling Patterns**     | Standardized approach to command processing and event handling                        |
| **Building read models**          | Built-in projections to build read models from recorded events.                       |
| **Type Safety**                   | First-class TypeScript support with structural typing                                 |
| **Express.js Integration**        | Seamless integration with Express.js, including conventional error handling etc.      |
| **Comprehensive Testing Support** | Tools for unit, integration, and E2E testing with BDD-style syntax                    |
| **Lightweight Design**            | Focused on composition over replacement, allowing integration with existing systems   |
| **Docker Testing Integration**    | Support for TestContainers to simplify database setup in tests                        |

## Why Use Emmett?

Nowadays, storage is cheap, but the information is priceless.

Event Sourcing, keeps all the facts that happened in our system as events. That provides an observability of the business process and enabling event-driven capabilities like building read models, easier integration between components.

**However, implementing Event Sourcing can be challenging due to:**

- additional learning curves for new developers,
- knowing how to structure your code,
- implementing event storage,
- difficulty in setting up proper testing strategies,
- integrating with existing frameworks and infrastructure.

**Emmett solves these problems by:**

- Reducing boilerplate with pragmatic abstractions,
- Providing clear patterns for common operations,
- Supporting multiple testing approaches with built-in utilities,
- Including ready-to-use event store implementations,
- Offering simple integration with Express.js.

## First steps

If you are new to Emmett or Event Sourcing, that is no problem, we've got you covered!

Check the [Quick Intro](/quick-intro) tutorial to familiarise you with basic concepts.

Then, the [Getting Started](/getting-started) guide will help you set up the first real application with Emmett.

You can also watch a full introduction video on how to build application:

<YouTubeEmbed id="SDXdcymKv-8" />

## Getting help

If you need help or get stuck, feel free to ask on the [Emmett Community Discord Server](https://discord.gg/fTpqUTMmVa).

## API reference

The [API reference](/api-reference/) provides you with definitions and insights into Emmett's core building blocks:

- **Events** are the centrepiece of event-sourced systems. They represent both critical points of the business process but are also used as the state.
- **Commands** represent the intent to perform a business operation.
- **Event Store** for recording events
- **Command Handlers** are responsible for handling business logic. They read events from the event store for specific events and build a decision model. Then, check business rules and perform the intended business operation, resulting in one or more events to record the change.

## How the documentation is organized

Currently, documentation for Emmett is spread across several places: This website, the [Emmett Discord](https://discord.gg/fTpqUTMmVa) and [quite a few blog articles](/overview#further-reading).
We are currently in the process of consolidating and refactoring these into a single document on this website.

Our aim is that each part of the documentation roughly falls into one of these four categories:

- **Tutorials** are lessons that take you by the hand, guiding you step-by-step towards building your own applications with Emmett. Start here if you are new to Emmett, Event Sourcing or writing applications with Typescript. Our [Getting Started](/getting-started) guide is a good place to look.
- **Topic guides** discuss key topics and concepts fairly well and provide useful background information and explanation.
- **Reference guides** contain technical references for APIs and other aspects of Emmett. They describe how it works and how to use it, but assume you have a basic understanding of key concepts.
- **How-to guides** are recipes. They guide you through the steps involved in addressing key problems and use-cases. They are more advanced than tutorials and assume some knowledge of how Emmett works.

We aim to use [Diataxis](https://diataxis.fr) and its [workflow](https://diataxis.fr/how-to-use-diataxis/) as a systematic, user-centric approach to documentation.

## Further reading

### Blog articles about Emmett

- [Announcing Emmett! Take your event-driven applications back to the future!](https://event-driven.io/en/introducing_emmett/)
- [Event Sourcing on PostgreSQL in Node.js just became possible with Emmett](https://event-driven.io/en/emmett_postgresql_event_store/)
- [Writing and testing event-driven projections with Emmett, Pongo and PostgreSQL](https://event-driven.io/en/emmett_projections_testing/)
- [Event Sourcing with Emmett: Reducing the Entry Barrier](https://medium.com/@mbneto/event-sourcing-with-emmett-how-to-reduce-the-entry-barrier-bf2d638c0437)
- [Testing Event Sourcing, Emmett edition](https://event-driven.io/en/testing_event_sourcing_emmett_edition/)
- [Using event metadata in event-driven projections](https://event-driven.io/en/projections_and_event_metadata/)
- [How to configure a custom Test Container on the EventStoreDB example](https://event-driven.io/en/custom_test_container_on_esdb_example/)

### Related Blogs

- [How TypeScript can help in modelling business workflows](https://event-driven.io/en/how_to_have_fun_with_typescript_and_workflow/)
- [How to build an in-memory Message Bus in TypeScript](https://event-driven.io/en/inmemory_message_bus_in_typescript/)
- [How to tackle compatibility issues in ECMA Script modules (and in general)](https://event-driven.io/en/how_to_tackle_esmodules_compatibility_issues/)
