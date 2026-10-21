# Add schemas to messages

Copy as Markdown[View as Markdown](/docs/development/guides/resources/schemas/add-schemas-to-messages.md)

***

Schemas can be added to any message type (Event, Command or Query).

## Adding a schema to a message[​](#adding-a-schema-to-a-message "Direct link to Adding a schema to a message")

Add the schema file next to the message and reference it with `schemaPath` in the message frontmatter.

/events/InventoryAdjusted/index.mdx

```
---
id: InventoryAdjusted
version: 0.0.4
schemaPath: schema.avro
---
```

* events

  <!-- -->

  /

  * InventoryAdjusted

    <!-- -->

    /

    * index.mdx
    * ![](/img/integrations/avro.svg)schema.avro

## Rendering schemas[​](#rendering-schemas "Direct link to Rendering schemas")

You can render schema files inside the message page with the [schema components](/docs/development/components/components/schema-viewer.md).

/events/InventoryAdjusted/index.mdx

```
<!-- Raw codeblock for your schema -->
<Schema file="schema.avro" />

<!-- Richer UI experinece for your schemas -->
<SchemaViewer file="schema.avro" />
```

Use `<Schema />` when you want to render the raw schema as a code block. Use `<SchemaViewer />` when you want a richer schema viewer for supported formats.

## Next steps[​](#next-steps "Direct link to Next steps")

Once schemas are attached to your messages, you can use the [Schema Explorer](/docs/development/guides/resources/schemas/explore-schemas/schema-explorer.md), [Fields Explorer](/docs/development/guides/resources/schemas/explore-schemas/fields-explorer.md), and [Schema API](/docs/development/guides/resources/schemas/schema-api.md) to make them easier to find and use.
