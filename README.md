[![](https://dcbadge.vercel.app/api/server/fTpqUTMmVa?style=flat)](https://discord.gg/fTpqUTMmVa) [<img src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" height="20px" />](https://www.linkedin.com/in/oskardudycz/) [![Github Sponsors](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&link=https://github.com/sponsors/event-driven-io)](https://github.com/sponsors/event-driven-io) [![blog](https://img.shields.io/badge/blog-event--driven.io-brightgreen)](https://event-driven.io/?utm_source=event_sourcing_nodejs) [![blog](https://img.shields.io/badge/%F0%9F%9A%80-Architecture%20Weekly-important)](https://www.architecture-weekly.com/?utm_source=event_sourcing_nodejs)

![](./src/docs/public/logo.png)

# Emmett - Event Sourcing development made simple

Nowadays, storage is cheap, but the information is priceless.

Event Sourcing, contrary to the standard approach, keeps all the facts that happened in our system. To do that, it needs an event store: a database designed for its needs.

**Take your event-driven applications back to the future!**

## Documentation and Resources

Read more in [documentation](https://event-driven-io.github.io/emmett/getting-started.html), join our [Discord Channel](https://discord.gg/fTpqUTMmVa) and ask any question.

Check also my blog articles on Emmett:

- [Announcing Emmett! Take your event-driven applications back to the future!](https://event-driven.io/en/introducing_emmett/)
- [Testing Event Sourcing, Emmett edition](https://event-driven.io/en/testing_event_sourcing_emmett_edition/)
- [Event Sourcing on PostgreSQL in Node.js just became possible with Emmett](https://event-driven.io/en/emmett_postgresql_event_store/)
- [Writing and testing event-driven projections with Emmett, Pongo and PostgreSQL](https://event-driven.io/en/emmett_projections_testing/)
- [Using event metadata in event-driven projections](https://event-driven.io/en/projections_and_event_metadata/)=

## FAQ

### **Is it production-ready?**

What's there is safe to use. I'd like to add more stuff to enhance the production experience, like OpenTelemetry, but users are already using Emmett in their systems.

### **Why Node.js?**

I like its minimalistic approach and flexibility, plus TypeScript is an excellent language with its shapeshifter capabilities. Plus, I've been asked if I could deliver such a store for Node.js.

### Why is it named Emmett?

[Because](https://en.m.wikipedia.org/wiki/Emmett_Brown).

### **What features it has?**

Essential building blocks for designing and running business and application logic like:

- typings around events, commands, Deciders, Workflows, etc.
- command handling wrappers for application layer,
- implementation of event store using PostgreSQL, EventStoreDB, MongoDB, and basic, in-memory version,
- abstractions for building read models,
- building blocks for the Web Apis with Event Sourcing and CQRS,
- serverless-friendly runtime model,

### **What features will it have?**

We'll see, but for sure, I'd like to have the following:

- implementation of event store using other storage engines like SQLite, DynamoDB, CosmosDB etc.
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

💖 If you'd like this initiative or want to use it potentially. Feel invited you **join** the group of my 👉 [Github Sponsors](https://github.com/sponsors/event-driven-io).

GitHub ⭐'s won't pay the bills, so any help is more than welcome!

## Contributing

Feel invited to contribute to Emmett. Check details in [contributing guide](CONTRIBUTING.md).

## Code of Conduct

This project has adopted the code of conduct defined by the [Contributor Covenant](http://contributor-covenant.org/) to clarify expected behavior in our community.
