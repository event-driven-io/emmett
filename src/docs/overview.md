# Overview

Everything you need to know about Emmett and Event Sourcing.

## First steps

If you are new to Emmett or Event Sourcing, no problem.

The [Getting Started](/getting-started) guide will help you with your first Emmett project.

## Getting help

If you need help or got stuck, feel free to ask on the [Emmett Community Discord Server](https://discord.gg/fTpqUTMmVa).

## API reference

The [API reference](/api-docs) provides you with definitions and insights of Emmetts core building blocks:

- **Events** are the centerpiece of event-sourced systems. They represent both critical points of the business process but are also used as the state.
- **Commands** represent the intent to perform a business operation.
- **Event Store** for recording events
- **Command Handlers** are responsible for handling business logic. They read events from the event store for specific events and build a decision model. Then, check business rules and perform the intended business operation, resulting in one or more events to record the change.

## How the documenantation is organized

Currently documentation for Emmett is spread across several places: This website, the [Emmett Discord](https://discord.gg/fTpqUTMmVa) and [quite a few blog articles](/overview#further-reading).
At the moment we are in the process of consolidating and refactoring these into a single documentation on this website.

Our aim is that each part of the documenation roughly falls into one of these four categories:

- **Tutorials** are lessons that take you by the hand, guiding you step-by-step towards building your own applications with Emmett. Start here if you are new to Emmett, Event Sourcing or writing applications with Typescript. Our [Getting Started](/getting-started) guide is a good place to look at.
- **Topic guides** discuss key topics and concepts at a fairly high level and provide useful background information and explanation.
- **Reference guides** contain technical reference for APIs and other aspects of Emmett. They describe how it works and how to use it, but assume that you have a basic understanding of key concepts.
- **How-to guides** are recipes. They guide you through the steps involved in addressing key problems and use-cases. They are more advanced than tutorials and assume some knowledge of how Emmett works.

In fact, we aim at using [Diataxis](https://diataxis.fr) and its [workflow](https://diataxis.fr/how-to-use-diataxis/) as a systematic, user-centric approach to documentation.

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
