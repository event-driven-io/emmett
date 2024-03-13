[![](https://dcbadge.vercel.app/api/server/fTpqUTMmVa?style=flat)](https://discord.gg/fTpqUTMmVa) [<img src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" height="20px" />](https://www.linkedin.com/in/oskardudycz/) [![Github Sponsors](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&link=https://github.com/sponsors/oskardudycz/)](https://github.com/sponsors/oskardudycz/) [![blog](https://img.shields.io/badge/blog-event--driven.io-brightgreen)](https://event-driven.io/?utm_source=event_sourcing_nodejs) [![blog](https://img.shields.io/badge/%F0%9F%9A%80-Architecture%20Weekly-important)](https://www.architecture-weekly.com/?utm_source=event_sourcing_nodejs)

![](./docs/public/logo.png)

# Emmett - Event Sourcing development made simple

Nowadays, storage is cheap, but the information is priceless.

Event Sourcing, contrary to the standard approach, keeps all the facts that happened in our system. To do that, it needs an event store: a database designed for its needs.

This project aims to experiment with an opinionated Event Sourcing framework based on my experience working on [Marten](https://martendb.io/) and [EventStoreDB](https://developers.eventstore.com/).

**Take your event-driven applications back to the future!**

## FAQ

### **Is it production-ready?**

Kinda. What is here is already usable, but you'll need to wait for the full production experience in all essential aspects.

### **Will it be production-ready?**

Hopefully.

### **Why Node.js?**

I like its minimalistic approach and flexibility, plus TypeScript is an excellent language with its shapeshifter capabilities. Plus, I've been asked if I could deliver such a store for Node.js.

### Why Emmett?

[Because](https://en.m.wikipedia.org/wiki/Emmett_Brown).

### **What features it has?**

Essential building blocks for designing and running business and application logic like:

- typings around events, commands, Deciders, Workflows, etc.
- command handling wrappers for application layer,
- implementation of event store using EventStoreDB and basic, in-memory version,
- building blocks for the Web Apis with Event Sourcing and CQRS.

### **What features will it have?**

We'll see, but for sure, I'd like to have the following:

- implementation of event store using PostgreSQL, SQLite, etc.
- abstractions for building read models,
- building blocks for integration and running distributed processes,
- GraphQL API for event stores,
- Full stack development helpers with Next.js or HTMX,
- built-in open telemetry,
- running it serverless or on the web with SQLite,
- streaming data through HTTP API (and enabling integration scenarios through it).
- defining event transformations and projections with WebAssembly,
- etc.

### **Would it be a competitor to other stores?**

Probably not. For now, I'd like to have a safe playground to have fun, experiment and try out new ideas. Still, I expect what I deliver to be safe to use in production.

### **Why there's no license?**

Because I'm unsure how this will end, and I don't want to expose it as an MIT license from the beginning.

## Support

💖 If you'd like this initiative or want to use it potentially. Feel invited you **join** the group of my 👉 [Github Sponsors](https://github.com/sponsors/oskardudycz).

GitHub ⭐'s won't pay the bills, so any help is more than welcome!

## Contributing

Feel invited to contribute to Emmett. Check details in [contributing guide](CONTRIBUTING.md).

## Code of Conduct

This project has adopted the code of conduct defined by the [Contributor Covenant](http://contributor-covenant.org/) to clarify expected behavior in our community.
