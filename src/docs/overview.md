# Overview

Welcome to Emmett's documentation!

![Emmett logo](/logo.png)

## What is Emmett?

**Emmett is an opinionated yet flexible framework that implements Event Sourcing for Node.js applications.** It focuses on composition rather than magic, providing lightweight abstractions and clear patterns that make Event Sourcing accessible and maintainable.

## Main Features

| Feature                       | Description                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Event-Centric Modeling**    | Structured approach to modeling business processes through events                                                                                                                        |
| **Multiple Event Stores**     | Built-in support for [PostgreSQL](/event-stores/postgresql), [EventStoreDB](/event-stores/esdb), [MongoDB](/event-stores/mongodb), [SQLite](/event-stores/sqlite), and In-Memory storage |
| **Command Handling Patterns** | Standardized approach with the [Decider pattern](/api-reference/decider)                                                                                                                 |
| **Projections**               | Built-in [projections](/guides/projections) to build read models from events                                                                                                             |
| **Workflows**                 | Coordinate multi-step processes with [durable execution](/guides/workflows)                                                                                                              |
| **Type Safety**               | First-class TypeScript support with structural typing                                                                                                                                    |
| **Web Framework Integration** | Seamless integration with [Express.js](/frameworks/expressjs) and [Fastify](/frameworks/fastify)                                                                                         |
| **Comprehensive Testing**     | [BDD-style testing](/guides/testing) with DeciderSpecification and ApiSpecification                                                                                                      |
| **TestContainers Support**    | Docker-based testing with pre-configured containers                                                                                                                                      |

## Why Use Emmett?

Storage is cheap, but information is priceless.

Event Sourcing keeps all the facts that happened in your system as events. This provides observability of business processes and enables event-driven capabilities like building read models and easier integration between components.

**However, implementing Event Sourcing can be challenging:**

- Learning curve for new developers
- Uncertainty about code structure
- Implementing event storage from scratch
- Setting up proper testing strategies
- Integrating with existing frameworks

**Emmett solves these problems:**

- Reduces boilerplate with pragmatic abstractions
- Provides clear patterns (Decider, Command Handler, Projections)
- Includes ready-to-use event store implementations
- Offers comprehensive testing utilities
- Integrates with Express.js and Fastify

## Quick Navigation

<div class="grid-cards">

### Getting Started

New to Emmett? Start here.

- [Quick Intro](/quick-intro) - Core concepts in 5 minutes
- [Getting Started](/getting-started) - Build your first app

### Guides

Learn key patterns and techniques.

- [Projections](/guides/projections) - Build read models
- [Testing](/guides/testing) - Test strategies
- [Error Handling](/guides/error-handling) - Handle errors gracefully
- [Workflows](/guides/workflows) - Multi-step processes

### Event Stores

Choose your persistence layer.

- [Comparison](/guides/choosing-event-store) - Which one to use?
- [PostgreSQL](/event-stores/postgresql) - Production-ready
- [EventStoreDB](/event-stores/esdb) - Native Event Sourcing
- [MongoDB](/event-stores/mongodb) - Document storage
- [SQLite](/event-stores/sqlite) - Development & testing

### Resources

Learn more and get help.

- [Samples](/samples/) - Working examples
- [Articles](/resources/articles) - Blog posts & tutorials
- [Packages](/resources/packages) - npm packages
- [Discord](https://discord.gg/fTpqUTMmVa) - Community help

</div>

## Video Introduction

Watch a full introduction on building applications with Emmett:

<YouTubeEmbed id="SDXdcymKv-8" />

## Getting Help

- **Discord**: Join the [Emmett Community](https://discord.gg/fTpqUTMmVa) for questions and discussions
- **GitHub Issues**: Report bugs at [event-driven-io/emmett](https://github.com/event-driven-io/emmett/issues)
- **Articles**: Browse [blog posts](/resources/articles) for in-depth tutorials

## Core Building Blocks

The [API reference](/api-reference/) covers Emmett's core abstractions:

| Concept                                          | Description                                  |
| ------------------------------------------------ | -------------------------------------------- |
| [Event](/api-reference/event)                    | Immutable facts that happened in your system |
| [Command](/api-reference/command)                | Requests to change state                     |
| [Event Store](/api-reference/eventstore)         | Persistence layer for event streams          |
| [Command Handler](/api-reference/commandhandler) | Processes commands into events               |
| [Decider](/api-reference/decider)                | Pattern for business logic (decide + evolve) |
| [Projections](/api-reference/projections)        | Build read models from events                |
| [Workflows](/api-reference/workflows)            | Coordinate multi-aggregate processes         |

## Documentation Structure

This documentation follows the [Diataxis](https://diataxis.fr) framework:

| Type              | Purpose                          | Examples                                                       |
| ----------------- | -------------------------------- | -------------------------------------------------------------- |
| **Tutorials**     | Learning-oriented, step-by-step  | [Getting Started](/getting-started)                            |
| **How-to Guides** | Task-oriented, problem-solving   | [Testing](/guides/testing), [Projections](/guides/projections) |
| **Reference**     | Information-oriented, technical  | [API Reference](/api-reference/)                               |
| **Explanation**   | Understanding-oriented, concepts | [Choosing an Event Store](/guides/choosing-event-store)        |

## Featured Articles

- [Announcing Emmett!](https://event-driven.io/en/introducing_emmett/) - Introduction and design philosophy
- [Event Sourcing on PostgreSQL](https://event-driven.io/en/emmett_postgresql_event_store/) - Setting up PostgreSQL
- [Testing Event Sourcing](https://event-driven.io/en/testing_event_sourcing_emmett_edition/) - Comprehensive testing guide

See all [blog articles](/resources/articles) for more tutorials and deep dives.
