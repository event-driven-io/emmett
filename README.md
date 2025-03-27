[![](https://dcbadge.vercel.app/api/server/fTpqUTMmVa?style=flat)](https://discord.gg/fTpqUTMmVa) [<img src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" height="20px" />](https://www.linkedin.com/in/oskardudycz/) [![Github Sponsors](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&link=https://github.com/sponsors/event-driven-io)](https://github.com/sponsors/event-driven-io) [![blog](https://img.shields.io/badge/blog-event--driven.io-brightgreen)](https://event-driven.io/?utm_source=event_sourcing_nodejs) [![blog](https://img.shields.io/badge/%F0%9F%9A%80-Architecture%20Weekly-important)](https://www.architecture-weekly.com/?utm_source=event_sourcing_nodejs)

![](./src/docs/public/logo.png)

# Emmett - Event Sourcing development made simple

**Emmett is an opinionated yet flexible framework that implements Event Sourcing for Node.js applications.** It focuses on composition rather than magic, providing lightweight abstractions and clear patterns that make Event Sourcing accessible and maintainable.

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

**Check Emmett and take your event-driven applications back to the future!**

## Features

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

## Documentation and Resources

Read more in [documentation](https://event-driven-io.github.io/emmett/getting-started.html), join our [Discord Channel](https://discord.gg/fTpqUTMmVa) and ask any question.

See the video tutorial to learn how to build a full application with it:

<a href="https://www.youtube.com/watch?v=SDXdcymKv-8" target="_blank"><img src="https://img.youtube.com/vi/SDXdcymKv-8/0.jpg" alt="Practical introduction to Event Sourcing with Spring Boot and EventStoreDB" width="320" height="240" border="10" /></a>

Check also my blog articles on Emmett:

- [Announcing Emmett! Take your event-driven applications back to the future!](https://event-driven.io/en/introducing_emmett/)
- [Testing Event Sourcing, Emmett edition](https://event-driven.io/en/testing_event_sourcing_emmett_edition/)
- [Event Sourcing on PostgreSQL in Node.js just became possible with Emmett](https://event-driven.io/en/emmett_postgresql_event_store/)
- [Writing and testing event-driven projections with Emmett, Pongo and PostgreSQL](https://event-driven.io/en/emmett_projections_testing/)
- [Using event metadata in event-driven projections](https://event-driven.io/en/projections_and_event_metadata/)

## FAQ

### **Is it production-ready?**

What's there is safe to use. I'd like to add more stuff to enhance the production experience, like OpenTelemetry, but users are already using Emmett in their systems.

### **Why Node.js?**

I like its minimalistic approach and flexibility, plus TypeScript is an excellent language with its shapeshifter capabilities. Plus, I've been asked if I could deliver such a store for Node.js.

### Why is it named Emmett?

[Because](https://en.m.wikipedia.org/wiki/Emmett_Brown).

### **What features will it have?**

We'll see, but for sure, I'd like to have the following:

- implementation of event store using other storage engines like DynamoDB, CosmosDB etc.
- building blocks for integration and running distributed processes,
- GraphQL API for event stores,
- Full stack development helpers with Next.js or HTMX,
- built-in open telemetry,
- streaming data through HTTP API (and enabling integration scenarios through it).
- defining event transformations and projections with WebAssembly,
- etc.

### **Would it be a competitor to other stores?**

It is hard to say; my intention is not to compete but to give more options to the community.

### **Why there's no license?**

Because I'm unsure how this will end, and I don't want to expose it as an MIT license from the beginning.

## Support

💖 If you'd like this project and want us to deliver more and faster, feel invited to **join** the group of our 👉 [Github Sponsors](https://github.com/sponsors/event-driven-io).

By doing so, you're helping to make our work on it sustainable and continuing our efforts so we can support your products.

**🥉 [Bronze Sponsors](https://github.com/sponsors/event-driven-io)**

- [productminds](https://github.com/pminds)
- [Lightest Night](https://github.com/lightest-night)

## Contributing

Emmett is a community project, so once you find something missing or not working, we encourage you to [send us a GH issue](https://github.com/event-driven-io/emmett/issues/new) or [Pull Request](https://github.com/event-driven-io/emmett/compare) extending the support or test coverage! Check also [Contributing guide](https://github.com/event-driven-io/emmett/blob/main/CONTRIBUTING.md)

**If you think something is missing or want to get some features faster, I'm happy to take sponsoring to prioritise it. Feel free to [contact me](mailto:oskar@event-driven.io) - we'll find a way to help you!**

## Code of Conduct

This project has adopted the code of conduct defined by the [Contributor Covenant](http://contributor-covenant.org/) to clarify expected behavior in our community.
