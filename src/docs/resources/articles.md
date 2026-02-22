---
documentationType: reference
outline: deep
---

# Blog Articles

A curated collection of articles about Emmett, Event Sourcing patterns, and related topics from [event-driven.io](https://event-driven.io/en/).

## Getting Started with Emmett

Start here if you're new to Emmett or Event Sourcing.

| Article                                                                                                     | Description                                      |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [Announcing Emmett!](https://event-driven.io/en/introducing_emmett/)                                        | Introduction to Emmett and its design philosophy |
| [Event Sourcing on PostgreSQL in Node.js](https://event-driven.io/en/emmett_postgresql_event_store/)        | Setting up the PostgreSQL event store            |
| [Testing Event Sourcing, Emmett edition](https://event-driven.io/en/testing_event_sourcing_emmett_edition/) | Comprehensive testing strategies                 |

## Projections & Read Models

Learn how to build and maintain read models from events.

| Article                                                                                                                | Description                                   |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| [Writing and testing event-driven projections](https://event-driven.io/en/emmett_projections_testing/)                 | Projection patterns with Pongo and PostgreSQL |
| [Using event metadata in projections](https://event-driven.io/en/projections_and_event_metadata/)                      | Advanced projection techniques with metadata  |
| [Dealing with Race Conditions in Read Models](https://event-driven.io/en/dealing_with_race_conditions_in_read_models/) | Handling concurrent updates to projections    |

## Message Processing

Deep dives into messaging patterns and consumers.

| Article                                                                                                                         | Description                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [Consumers, projectors, reactors and all that messaging jazz](https://event-driven.io/en/emmett_consumers_projectors_reactors/) | Understanding Emmett's messaging model       |
| [Checkpointing the message processing](https://event-driven.io/en/checkpointing_the_message_processing/)                        | Reliable message processing with checkpoints |
| [Multi-tenancy and dynamic messaging workload distribution](https://event-driven.io/en/multi_tenancy_and_dynamic_messaging/)    | Scaling message processing                   |
| [Idempotent Command Handling](https://event-driven.io/en/idempotent_command_handling/)                                          | Ensuring exactly-once semantics              |

## Event Store Implementations

Building and understanding event stores.

| Article                                                                                                   | Description                         |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| [How to build MongoDB Event Store](https://event-driven.io/en/how_to_build_mongodb_event_store/)          | MongoDB as an event store           |
| [Let's build an Event Store in one hour!](https://event-driven.io/en/lets_build_event_store_in_one_hour/) | Understanding event store internals |
| [Event stores are key-value databases](https://event-driven.io/en/event_stores_are_key_value_stores/)     | Mental model for event stores       |

## Pongo (PostgreSQL Document Database)

Emmett's companion library for document storage in PostgreSQL.

| Article                                                                                                                         | Description                |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| [Pongo - Mongo but on Postgres](https://event-driven.io/en/pongo_postgres_mongo/)                                               | Introduction to Pongo      |
| [Pongo behind the scenes](https://event-driven.io/en/pongo_behind_the_scenes/)                                                  | How Pongo works internally |
| [Pongo gets strongly-typed client, migrations, and CLI](https://event-driven.io/en/pongo_strongly_typed_client_migrations_cli/) | Advanced Pongo features    |
| [Running regular SQL on Pongo documents](https://event-driven.io/en/running_sql_on_pongo_documents/)                            | SQL interoperability       |

## TypeScript & Patterns

General patterns useful for event-driven development.

| Article                                                                                                                             | Description                       |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| [How TypeScript can help in modelling business workflows](https://event-driven.io/en/how_to_have_fun_with_typescript_and_workflow/) | TypeScript patterns for workflows |
| [How to build an in-memory Message Bus in TypeScript](https://event-driven.io/en/inmemory_message_bus_in_typescript/)               | Message bus implementation        |
| [How to tackle ESM compatibility issues](https://event-driven.io/en/how_to_tackle_esmodules_compatibility_issues/)                  | Managing module compatibility     |
| [Mocking the native Node.js Test Runner](https://event-driven.io/en/mocking_native_nodejs_test_runner/)                             | Testing techniques                |

## Infrastructure & DevOps

Practical guides for running Emmett in production.

| Article                                                                                                      | Description                      |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| [How to configure a custom TestContainer](https://event-driven.io/en/custom_test_container_on_esdb_example/) | EventStoreDB TestContainer setup |
| [Docker Compose Profiles](https://event-driven.io/en/docker_compose_profiles/)                               | Managing Docker environments     |

## Event Sourcing Concepts

Deeper understanding of Event Sourcing principles.

| Article                                                                                                                                          | Description                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| [Event Streaming is not Event Sourcing](https://event-driven.io/en/event_streaming_is_not_event_sourcing/)                                       | Key distinctions                   |
| [How to get the current entity state from events?](https://event-driven.io/en/how_to_get_the_current_entity_state_in_event_sourcing/)            | State aggregation patterns         |
| [Should you throw an exception when rebuilding state?](https://event-driven.io/en/should_you_throw_exception_when_rebuilding_state_from_events/) | Error handling in evolve functions |
| [Slim your entities with Event Sourcing](https://event-driven.io/en/slim_your_entities_with_event_sourcing/)                                     | Keeping state focused              |
| [Optimistic concurrency for pessimistic times](https://event-driven.io/en/optimistic_concurrency_for_pessimistic_times/)                         | Concurrency control strategies     |
| [How to use ETag header for optimistic concurrency](https://event-driven.io/en/how_to_use_etag_header_for_optimistic_concurrency/)               | HTTP-based concurrency             |

## Community Articles

Articles written by the community.

| Article                                                                                                                                                      | Author  | Description                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------------------------- |
| [Event Sourcing with Emmett: Reducing the Entry Barrier](https://medium.com/@mbneto/event-sourcing-with-emmett-how-to-reduce-the-entry-barrier-bf2d638c0437) | @mbneto | Getting started perspective |

## Learning Paths

### Beginner Path

1. [Announcing Emmett!](https://event-driven.io/en/introducing_emmett/) - Understand the motivation
2. [Event Sourcing on PostgreSQL in Node.js](https://event-driven.io/en/emmett_postgresql_event_store/) - Set up your first event store
3. [Testing Event Sourcing, Emmett edition](https://event-driven.io/en/testing_event_sourcing_emmett_edition/) - Learn testing patterns

### Intermediate Path

1. Complete Beginner Path
2. [Writing and testing event-driven projections](https://event-driven.io/en/emmett_projections_testing/) - Build read models
3. [Consumers, projectors, reactors](https://event-driven.io/en/emmett_consumers_projectors_reactors/) - Understand message processing
4. [Checkpointing the message processing](https://event-driven.io/en/checkpointing_the_message_processing/) - Reliable processing

### Advanced Path

1. Complete Intermediate Path
2. [Dealing with Race Conditions in Read Models](https://event-driven.io/en/dealing_with_race_conditions_in_read_models/) - Handle edge cases
3. [Multi-tenancy and dynamic messaging](https://event-driven.io/en/multi_tenancy_and_dynamic_messaging/) - Scale your system
4. [Idempotent Command Handling](https://event-driven.io/en/idempotent_command_handling/) - Production resilience

## Stay Updated

- **Blog:** [event-driven.io](https://event-driven.io/en/)
- **Newsletter:** [Architecture Weekly](https://www.architecture-weekly.com/)
- **Discord:** [Emmett Community](https://discord.gg/fTpqUTMmVa)
- **GitHub:** [event-driven-io/emmett](https://github.com/event-driven-io/emmett)

## See Also

- [Getting Started](/getting-started) - Official tutorial
- [Sample Applications](/samples/) - Working examples
- [Packages](/resources/packages) - All Emmett packages
