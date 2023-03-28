[![Twitter Follow](https://img.shields.io/twitter/follow/oskar_at_net?style=social)](https://twitter.com/oskar_at_net) [![Github Sponsors](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&link=https://github.com/sponsors/oskardudycz/)](https://github.com/sponsors/oskardudycz/) [![blog](https://img.shields.io/badge/blog-event--driven.io-brightgreen)](https://event-driven.io/?utm_source=event_sourcing_nodejs) [![blog](https://img.shields.io/badge/%F0%9F%9A%80-Architecture%20Weekly-important)](https://www.architecture-weekly.com/?utm_source=event_sourcing_nodejs)

# Emmett - a Node.js Event Store

Nowadays, storage is cheap, but the information is priceless.

Event Sourcing, contrary to the standard approach, keeps all the facts that happened in our system. To do that, it needs an event store: a database designed for its needs.

**This project aims to deliver an opinionated event store based on my experience working on [Marten](martendb.io/) and [EventStoreDB](https://developers.eventstore.com/).**

Check my inspirations and what I'm up to in [Reference materials](./ReferenceMaterials.md).

## FAQ

### **Is it production-ready?**

Nope.

### **Will it be?**

Maybe.

### **Why Node.js?**

I like its minimalistic approach and flexibility, plus TypeScript is an excellent language with its shapeshifter capabilities. Plus, I've been asked if I could deliver such a store for Node.js.

### Why Emmeett?

[Because](https://en.m.wikipedia.org/wiki/Emmett_Brown).

### **What features it has?**

Currently, none, but that will change.

### **What features will it have?**

We'll see, but for sure, I'd like to have the following:

- atomicity of the stream append operations,
- reading your writes,
- subscriptions based on Postgres logical replications,
- Postgres partitioning,
- running it serverless or on the web with SQLite,
- streaming data through HTTP API (and enabling integration scenarios through it).
- defining event transformations and projections with WebAssembly,
- build-in read models based on the JSON capabilities of Postgres and SQLite.

### **Would it be a competitor to other stores?**

Probably not. For now, I'd like to have a safe playground to have fun and try out new ideas. Still, what I deliver, I expect to be safe to use on a small scale.

### **Why there's no license?**

Because I'm unsure when this will end, and I don't want to expose it as an MIT license from the beginning.

## Support

💖 If you'd like this initiative or want to use it potentially. Feel invited you **join** the group of my 👉 [Github Sponsors](https://github.com/sponsors/oskardudycz).

GitHub ⭐'s won't pay the bills, so any help is more than welcome!
