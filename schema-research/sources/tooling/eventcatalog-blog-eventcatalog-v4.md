[All articles](/blog.md)

EventCatalog/JULY 2, 2026

# Introducing EventCatalog v4

1

<!-- -->

MINUTES READ

![David Boyne](https://avatars.githubusercontent.com/u/3268013?v=4)

David Boyne

Founder

Share this article

[](https://www.linkedin.com/sharing/share-offsite/?url=%2Fblog%2Feventcatalog-v4)[](https://twitter.com/intent/tweet?text=Introducing%20EventCatalog%20v4\&url=%2Fblog%2Feventcatalog-v4)[](https://news.ycombinator.com/submitlink?u=%2Fblog%2Feventcatalog-v4\&t=Introducing%20EventCatalog%20v4)

![](/img/blogs/eventcatalog-v4-og.png)

Summary

EventCatalog v4 adds a new vision for our project. New system resource type, context maps, and simpler discovery. EventCatalog CI/CD Agent and faster catalogs. A better community edition, and clearer license models.

EventCatalog started in 2022 as a small open source project for documenting events in event-driven architectures.

Since then, more than 40,000 catalogs have been created by teams around the world. Along the way, EventCatalog has grown beyond events. Teams are using it to document domains, services, schemas, specifications, ownership, diagrams, and the relationships between them.

That has made one thing clear: our community is not only documenting events. **They are using EventCatalog to document their software architecture.**

### Our new vision[​](#our-new-vision "Direct link to Our new vision")

Most documentation tools are not designed for software architecture. They are built around generic pages, folder trees, and diagrams that often live outside the context of the systems they describe.

Over time, that information gets scattered. Pages drift from production reality, diagrams become stale, and teams stop trusting the documentation.

**We believe there must be a better way.**

Architecture documentation should reflect the way architects and engineers already think and model systems. It should use primitives and patterns they understand: domains, systems, services, messages, schemas, ownership, flows, and diagrams.

It should also stay connected to the real architecture. Specifications, registries, code, and documentation should be able to move together, because documentation is a living artifact, not something you write once and forget.

This information should also be accessible to AI agents and AI-assisted engineering tools. EventCatalog is not just a set of pages, it is a graph of your architecture: the domains, systems, services, messages, schemas, owners, and relationships that explain how your organization works. That graph gives AI tools the context they need to reason about real software systems, not a generic version of them.

This is the direction we are taking EventCatalog. We believe EventCatalog can become the open source documentation tool architects use to describe, understand, and evolve their software architecture. That means going beyond events and giving teams better ways to document the systems, boundaries, resources, and relationships that make up their organization.

Today, I am happy to announce **EventCatalog v4**, the first release shaped around this vision.

This release introduces:

* **Systems**: a new way to document software capabilities, external systems, and the resources that belong to them.
* **Clearer architecture levels**: domains, systems, and resources now give teams a more natural hierarchy for moving from the big picture to implementation detail.
* **A simpler, more generous Community Edition**: more capability is available without needing a commercial license.
* **Simpler licensing**: clearer plans for teams that want to take their catalog further with Scale.

## What's new in EventCatalog v4[​](#whats-new-in-eventcatalog-v4 "Direct link to What's new in EventCatalog v4")

### Systems are now a first-class resource[​](#systems-are-now-a-first-class-resource "Direct link to Systems are now a first-class resource")

The biggest change in v4 is the new [systems resource](/docs/development/guides/systems/introduction.md).

A system is a collection of resources that work together to perform a function. That might be checkout, payment processing, product search, customer identity, fraud review, a third-party payment provider, or an internal platform capability.

Systems sit at a useful level between domains and implementation details:

* **Domains** describe a business boundary or bounded context.
* **Systems** describe a software capability or external system.
* **Resources** describe the services, messages, flows, data stores, entities, and diagrams that make up that system.

For example, your `Payments` domain might contain a `Payment Processing System`. That system can own the API, worker, events, data store, checkout flow, and entities involved in payment authorization and capture.

domains/Payments/systems/payment-processing-system/index.mdx

```
---
id: payment-processing-system
name: Payment Processing System
version: 1.0.0
summary: Handles payment authorization, capture, and refund processing.
owners:
  - payments-platform
services:
  - id: PaymentAPI
flows:
  - id: CheckoutSaga
containers:
  - id: payments-db
entities:
  - id: payment
relationships:
  - id: fraud-detection
    version: 1.0.0
    label: requests fraud checks from
actors:
  - id: shopper
    name: Shopper
    label: submits payment details
    direction: inbound
---

## Overview

The Payment Processing System owns payment authorization, capture, refund processing, and the payment events consumed by downstream systems.
```

This gives teams a natural place to document the system they own, not just the individual services inside it.

### System context maps[​](#system-context-maps "Direct link to System context maps")

Systems can define relationships to other systems and actors. EventCatalog uses those relationships to create [system context maps](/docs/development/guides/systems/system-context-maps.md).

This gives you a high-level map of how systems connect across your architecture. From that map, users can drill into one system and inspect the services, APIs, messages, data stores, entities, and flows that make it work.

![System context map showing systems, actors, and relationships across a product catalog](/assets/images/eventcatalog-v4-system-context-map-4a48312c85f235a69ed5536fb6695a1d.png)

You can open the global map at:

```
/visualiser/system-context-map
```

You can also open a single system in context:

```
/visualiser/systems/{system-id}/{version}/context
```

This is useful for onboarding, architecture reviews, incident response, and planning changes. A new engineer can start with the system context map, then drill into the system they need instead of starting from a long list of resources.

### System resource diagrams[​](#system-resource-diagrams "Direct link to System resource diagrams")

Systems also get a lower-level resource diagram that shows what is inside the system.

Add `<NodeGraph />` to a system page and EventCatalog renders the services, flows, entities, data stores, and related resources that make up that system.

domains/Payments/systems/payment-processing-system/index.mdx

```
## Resource Diagram

<NodeGraph />

## Context Diagram

<ContextDiagram />
```

![System resource diagram showing services, queries, events, and data stores inside a search system](/assets/images/eventcatalog-v4-system-resource-map-71d9a4059989e3d12926c36a66216d5e.png)

The context diagram answers "how does this system fit into the wider architecture?"

The resource diagram answers "what is this system made of?"

That distinction matters. Architects often need the first view, while engineers making a change often need the second.

### A simpler Catalog experience[​](#a-simpler-catalog-experience "Direct link to A simpler Catalog experience")

EventCatalog v4 simplifies discovery.

Instead of sending users through separate explore pages for each resource type, v4 introduces a single Catalog experience with a Kind filter. Users can browse domains, systems, services, messages, flows, entities, data stores, ADRs, teams, and other resources from one place.

This reduces the amount of navigation knowledge users need before they can find something. They do not need to know whether a thing lives under "services", "messages", "schemas", or "flows" before they start searching.

For larger organizations, this should make EventCatalog feel more like an architecture catalog and less like a set of separate resource lists.

### Simpler vertical navigation[​](#simpler-vertical-navigation "Direct link to Simpler vertical navigation")

The Application sidebar has also been simplified.

Teams can now configure the vertical navigation using `navigation.groups`, including labels, ordering, icons, custom links, visibility, and bottom-positioned groups.

![EventCatalog application sidebar with grouped vertical navigation](/assets/images/eventcatalog-v4-application-sidebar-6114b292db8f1e4e14a00c5c29a2abc2.png)

eventcatalog.config.js

```
export default {
  navigation: {
    groups: [
      {
        id: 'main',
        items: [{ id: 'home' }, { id: 'docs' }],
      },
      {
        id: 'browse',
        label: 'Browse',
        items: [{ id: 'catalog' }, { id: 'schemas' }],
      },
      {
        id: 'platform',
        label: 'Platform',
        items: [
          {
            id: 'platform-docs',
            label: 'Platform Docs',
            icon: 'BookOpen',
            href: '/docs/custom/platform/overview',
            match: ['/docs/custom/platform'],
          },
        ],
      },
    ],
  },
};
```

This replaces the older `sidebar` configuration and gives teams more control over the first thing users see when they open the catalog.

You can read more in the [v4 upgrade guide](/docs/development/upgrading/v4.md).

## More available in Community Edition[​](#more-available-in-community-edition "Direct link to More available in Community Edition")

Two capabilities are moving into Community Edition.

**Custom homepages are now available in Community Edition.** You can create `pages/homepage.astro` and make the first page of your catalog fit your organization, your onboarding flow, or your architecture overview.

Custom homepages can also embed the new system context map:

pages/homepage.astro

```
---
import { SystemContextMap } from '@eventcatalog/core/components';
---

<main>
  <h1>Architecture Catalog</h1>
  <SystemContextMap />
</main>
```

**Diagram comparison is also now available in Community Edition.** Teams can compare diagram versions without needing a paid feature flag.

These changes are intentional. The core experience of understanding and communicating your architecture should be accessible to every team using EventCatalog.

## Systems in the SDK and AI tools[​](#systems-in-the-sdk-and-ai-tools "Direct link to Systems in the SDK and AI tools")

v4 also adds [SDK](/docs/sdk.md) support for systems.

Generators and internal integrations can now read and write systems, add resources to systems, write resources directly into a system, and attach systems to domains.

This matters for teams that automate their catalog from source code, service metadata, API specifications, schema registries, or internal platforms. Systems are not only a UI concept, they are part of the EventCatalog data model.

EventCatalog Assistant, the MCP server, and catalog tools also understand systems. That means AI workflows can answer questions at a more useful level:

* "What systems are involved in checkout?"
* "Which services make up the Payment Processing System?"
* "What depends on the Fraud Detection System?"
* "Generate a diagram for this system."

As more teams connect AI tools to their architecture documentation, this higher-level model becomes important. AI needs more than a list of services. It needs the boundaries and relationships that explain why those services exist.

## EventCatalog Agent[​](#eventcatalog-agent "Direct link to EventCatalog Agent")

We are also starting to roll out [EventCatalog Agent](/docs/development/ask-your-architecture/agents.md), a set of agent workflows that help keep your catalog in sync with the systems your teams are changing.

The first workflow is the [Code-to-Docs agent](/docs/development/ask-your-architecture/agents/code-to-docs.md). When you open a pull request, it reviews the diff, works out whether the catalog documentation should change, updates the catalog, and opens a documentation pull request for your team to review.

This is part of the same direction as v4. If EventCatalog is the graph of your architecture, then agents can help keep that graph up to date as code changes. They can also bring catalog context into pull requests, including checks that help teams catch schema breaking changes before they reach production.

This is still early, but you can start using it today and give us feedback. Read the [EventCatalog Agent documentation](/docs/development/ask-your-architecture/agents.md), try the [Code-to-Docs agent](/docs/development/ask-your-architecture/agents/code-to-docs.md), or learn more about schema checks in the [EventCatalog GitHub Action post](/blog/github-actions.md).

## Business model changes[​](#business-model-changes "Direct link to Business model changes")

We are also simplifying how teams try and buy EventCatalog.

**EventCatalog trials now last 30 days**, giving teams more time to evaluate EventCatalog with real architecture data instead of rushing through a short proof of concept.

We are removing the old Starter plan. EventCatalog Cloud and paid self-hosted features are being simplified around the Scale plan, and EventCatalog integrations are now available on Scale.

For existing customers, nothing is being taken away. Existing customers will be grandfathered on their current plans, and we will offer discounts for teams that want to move to the new Scale plan.

The goal is simple: less plan complexity, more time to evaluate, and a clearer path for teams that want EventCatalog with integrations, automation, and scale features.

## Upgrading to v4[​](#upgrading-to-v4 "Direct link to Upgrading to v4")

Upgrade EventCatalog with your package manager:

```
npm install @eventcatalog/core@latest
```

Most v3 catalogs should continue to build without moving resources into systems. For the full list of changes and migration steps, read the [v4 upgrade guide](/docs/development/upgrading/v4.md).

We recommend creating a branch, upgrading `@eventcatalog/core`, running your catalog locally, and checking any custom pages, custom navigation, and visualiser links.

## Looking ahead[​](#looking-ahead "Direct link to Looking ahead")

Systems give EventCatalog a stronger foundation for the next stage of architecture documentation.

They help humans understand the operating model of a system, and they give AI tools better context about boundaries, ownership, relationships, and dependencies.

Over the next few months we will keep improving systems, diagrams, the Catalog experience, and the workflows that help teams keep documentation up to date from the tools they already use.

## Thank you[​](#thank-you "Direct link to Thank you")

EventCatalog v4 is shaped by the teams using EventCatalog on real architectures every day.

Every Discord conversation, GitHub issue, support call, and customer catalog has helped clarify where the product needed to go next.

If you like EventCatalog, [I would love a star on GitHub](https://github.com/event-catalog/eventcatalog), and feel free to join our [Discord community](https://discord.gg/eventcatalog).

Thank you for being part of the journey.

***

**Ready to get started?**

```
# New catalog
npx @eventcatalog/create-eventcatalog@latest my-catalog

# Upgrade existing catalog
npm install @eventcatalog/core@latest
```

[Read the upgrade guide](/docs/development/upgrading/v4.md) | [Read the systems docs](/docs/development/guides/systems/introduction.md) | [Join Discord](https://discord.gg/eventcatalog)

On this page

* [Our new vision](#our-new-vision)
* [What's new in EventCatalog v4](#whats-new-in-eventcatalog-v4)
* [Systems are now a first-class resource](#systems-are-now-a-first-class-resource)
* [System context maps](#system-context-maps)
* [System resource diagrams](#system-resource-diagrams)
* [A simpler Catalog experience](#a-simpler-catalog-experience)
* [Simpler vertical navigation](#simpler-vertical-navigation)
* [More available in Community Edition](#more-available-in-community-edition)
* [Systems in the SDK and AI tools](#systems-in-the-sdk-and-ai-tools)
* [EventCatalog Agent](#eventcatalog-agent)
* [Business model changes](#business-model-changes)
* [Upgrading to v4](#upgrading-to-v4)
* [Looking ahead](#looking-ahead)
* [Thank you](#thank-you)
