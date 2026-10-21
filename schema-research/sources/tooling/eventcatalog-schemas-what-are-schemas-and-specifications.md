# What are schemas and specifications?

Copy as Markdown[View as Markdown](/docs/development/guides/resources/schemas/what-are-schemas-and-specifications.md)

***

EventCatalog supports **any schema or specification format**, including (but not limited to) JSON / YAML, Avro, Protobuf, GraphQL, OpenAPI, AsyncAPI.

Schemas can be stored in EventCatalog or synced from remote registries/locations.

Schemas are **optional**, but they add valuable context to your resources (e.g messages, services and domains).

### Why add schemas?[​](#why-add-schemas "Direct link to Why add schemas?")

By adding schemas to your catalog you unlock several benefits:

* **Schema Explorer** – Your teams can quickly find and browse schemas across your architecture [(see demo)](https://demo.eventcatalog.dev/schemas/explorer)
* **Fields Explorer** – Drill down into properties of every schema, find duplications and mismatches [(see guide)](/docs/development/guides/resources/schemas/explore-schemas/fields-explorer.md)
* **API access** – Programatic access to your schemas through your Catalog API. [(see guide)](/docs/development/guides/resources/schemas/schema-api.md)
* **AI Context** – Give LLMs context of your schemas with the [EventCatalog MCP](/docs/development/ask-your-architecture/mcp-server/introduction.md)
* **Visualization** – Help developers understand data structures using [schema property search and visualization](/docs/development/components/components/schema-viewer.md)
