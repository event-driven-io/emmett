[All articles](/blog.md)

EventCatalog/AUGUST 27, 2026

# Schema registry vs Architecture Catalog

1

<!-- -->

MINUTES READ

![David Boyne](https://avatars.githubusercontent.com/u/3268013?v=4)

David Boyne

Founder

Share this article

[](https://www.linkedin.com/sharing/share-offsite/?url=%2Fblog%2Fschema-registry-vs-architecture-catalog)[](https://twitter.com/intent/tweet?text=Schema%20registry%20vs%20Architecture%20Catalog\&url=%2Fblog%2Fschema-registry-vs-architecture-catalog)[](https://news.ycombinator.com/submitlink?u=%2Fblog%2Fschema-registry-vs-architecture-catalog\&t=Schema%20registry%20vs%20Architecture%20Catalog)

![](/img/blogs/schema-registry-vs-architecture-catalog/schema-registry-vs-architecture-catalog-og.png)

Summary

A schema registry stores the contract. An architecture catalog shows how that contract fits the system. You often want both.

A schema registry stores the contract: the shape of an event or message. An architecture catalog tells you how that contract fits the system: who produces it, who consumes it, which domain it belongs to, and what else breaks if you change it.

You often want both. A registry without a catalog is a drawer of schemas with no map. A catalog without schemas is a map with no contracts.

![A schema registry shown as a filing cabinet of JSON Schema, Avro, and Protobuf files, versus an architecture catalog shown as a map of services around an OrderCreated event](/img/blogs/schema-registry-vs-architecture-catalog/schema-registry-vs-catalog-hero.png)A schema registry files the contract. An architecture catalog maps how that contract is used.

I keep seeing teams treat these as the same thing. They are not. One is the filing cabinet. The other is the map. That mix-up is an overlooked part of event-driven architecture, and it usually shows up the first time someone asks "who actually consumes this event?"

## What a schema registry actually does[​](#what-a-schema-registry-actually-does "Direct link to What a schema registry actually does")

In an event-driven system, a producer publishes a message and a consumer reads it. Those two sides need to agree on the shape of the payload. If they do not, something breaks, often at 2am, often in a service the producer team has never heard of.

A schema registry is where that agreement lives.

You register a JSON Schema, Avro, or Protobuf definition. Producers and consumers fetch it. Compatibility rules decide whether a new version is safe to roll out. BACKWARD, FORWARD, FULL. The registry is good at this. That is its job.

![Producer sends an event to a consumer, with the schema hanging off the event and circled as what a schema registry stores](/img/blogs/schema-registry-vs-architecture-catalog/what-a-schema-registry-stores.png)The registry stores the schema, not the producer, the consumer, or the reason the event exists.

[Confluent Schema Registry](https://docs.confluent.io/platform/current/schema-registry/index.html), [Apicurio Registry](https://www.apicur.io/registry/), [AWS Glue Schema Registry](https://docs.aws.amazon.com/glue/latest/dg/schema-registry.html), [Azure Schema Registry](https://learn.microsoft.com/en-us/azure/event-hubs/schema-registry-overview), and even a GitHub repo of `.avsc` files are all doing this work. They store the contract and help you evolve it without silently breaking consumers.

That is valuable. Schema registries are not the problem.

## What a schema registry does not do[​](#what-a-schema-registry-does-not-do "Direct link to What a schema registry does not do")

Open your registry. You will find versions of `OrderCreated`. You will not find:

* Who produces it
* Who consumes it
* Which [domain](/docs/development/guides/domains/introduction.md) it belongs to
* Who owns it
* Why it exists
* What else breaks if you change `customerId` from a string to a UUID

The registry has the contract. It does not have the map.

When an engineer asks "can I add a field to this event?", the registry can tell them if the new schema is compatible. It cannot tell them that Inventory, Shipping, Notifications, and a three-year-old analytics job all consume it. That blast radius lives in people's heads, Slack threads, and [architecture decision records](/docs/development/guides/resources/adrs/introduction.md) that nobody linked to the event.

We got very good at storing schemas. We stayed bad at explaining how those schemas are used.

## What an architecture catalog is[​](#what-an-architecture-catalog-is "Direct link to What an architecture catalog is")

An architecture catalog is the map.

It still has the [schema](/docs/development/guides/resources/schemas/what-are-schemas-and-specifications.md). It also has the producer, the consumers, the domain boundary, the owners, the docs, and the decisions that explain why the [event](/docs/development/guides/resources/messages/message-types/events.md) exists in the first place.

![Orders domain showing Order Service and Inventory Service with owners, an OrderCreated event, its schema, and downstream consumers](/img/blogs/schema-registry-vs-architecture-catalog/what-an-architecture-catalog-adds.png)The catalog keeps the schema, then adds producers, consumers, owners, and the domain it belongs to.

EventCatalog is one example of this. It is not a schema registry. It sits alongside the registry you already have.

You keep Confluent, Apicurio, Glue, Azure, or GitHub as the source of truth for the contract. The catalog imports those schemas and attaches the context the registry never stored: [services](/docs/development/guides/resources/services/introduction.md), domains, owners, documentation, ADRs.

A catalog without schemas is a map with no contracts. Pretty diagrams, stale payloads. A registry without a catalog is a drawer of schemas with no map. You can find the JSON. You cannot find the blast radius.

## Schema registry vs architecture catalog[​](#schema-registry-vs-architecture-catalog "Direct link to Schema registry vs architecture catalog")

|                           | Schema registry                                              | Architecture catalog                                                |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| Stores                    | The contract: Avro, JSON Schema, Protobuf                    | The contract plus producers, consumers, domains, owners, and docs   |
| Primary job               | Compatibility and evolution                                  | Discoverability and context                                         |
| Typical tools             | Confluent, Apicurio, AWS Glue, Azure Schema Registry, GitHub | EventCatalog                                                        |
| Answers questions like... | Is this change compatible? What does the payload look like?  | Who produces this? Who consumes it? Which domain? What else breaks? |

Same event. Different jobs. You often want both.

## When you need both[​](#when-you-need-both "Direct link to When you need both")

At the start, a registry is enough. One team, a handful of events, everyone still remembers who owns what.

Then the architecture grows. New consumers appear without telling the producer. A schema change is "compatible" and still takes down a service in another domain. A new engineer spends a week hunting for the owner of `OrderCreated`.

That is when the catalog starts to matter.

Most EDA teams I talk to already have a schema registry. The gap is not another place to put Avro files. The gap is answering "how does this event fit the system?" without pinging three Slack channels.

Keep the registry. Add the map.

## FAQ[​](#faq "Direct link to FAQ")

### What is a schema registry?[​](#what-is-a-schema-registry "Direct link to What is a schema registry?")

A schema registry is a store for message contracts. It holds Avro, JSON Schema, Protobuf, and similar definitions, versions them, and enforces compatibility so producers and consumers can share a payload shape without guessing.

### What is an architecture catalog?[​](#what-is-an-architecture-catalog "Direct link to What is an architecture catalog?")

An architecture catalog is a map of the system around those contracts. It records who produces a message, who consumes it, which domain it belongs to, who owns it, and the documentation and decisions that explain why it exists.

### Do I need EventCatalog if I already have Confluent Schema Registry?[​](#do-i-need-eventcatalog-if-i-already-have-confluent-schema-registry "Direct link to Do I need EventCatalog if I already have Confluent Schema Registry?")

Not instead of it. Confluent Schema Registry (or Apicurio, Glue, Azure, GitHub) should keep doing the contract work. EventCatalog sits alongside that registry and adds the producers, consumers, domains, and ownership the registry does not store.

### Can EventCatalog replace a schema registry?[​](#can-eventcatalog-replace-a-schema-registry "Direct link to Can EventCatalog replace a schema registry?")

No. EventCatalog is not a schema registry, and it should not replace Confluent Schema Registry or anything like it. They complement each other. The registry holds the contract. The catalog holds the map.

## Keep the registry, add the map[​](#keep-the-registry-add-the-map "Direct link to Keep the registry, add the map")

If you already run a schema registry and want that contract sitting next to the rest of the architecture, EventCatalog can import from it. Start with the [plugin docs](/docs/plugins/intro.md).

On this page

* [What a schema registry actually does](#what-a-schema-registry-actually-does)
* [What a schema registry does not do](#what-a-schema-registry-does-not-do)
* [What an architecture catalog is](#what-an-architecture-catalog-is)
* [Schema registry vs architecture catalog](#schema-registry-vs-architecture-catalog)
* [When you need both](#when-you-need-both)
* [FAQ](#faq)
* [What is a schema registry?](#what-is-a-schema-registry)
* [What is an architecture catalog?](#what-is-an-architecture-catalog)
* [Do I need EventCatalog if I already have Confluent Schema Registry?](#do-i-need-eventcatalog-if-i-already-have-confluent-schema-registry)
* [Can EventCatalog replace a schema registry?](#can-eventcatalog-replace-a-schema-registry)
* [Keep the registry, add the map](#keep-the-registry-add-the-map)
