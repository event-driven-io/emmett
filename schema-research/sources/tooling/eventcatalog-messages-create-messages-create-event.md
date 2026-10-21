# Create an event

Copy as Markdown[View as Markdown](/docs/development/guides/resources/messages/create-messages/create-event.md)

***

Events are a type of message in EventCatalog that represent an immutable fact.

![Example](/assets/images/example-186ee48a185f5afb6688485ebebd3ec9.png)

## Adding a new event[​](#adding-a-new-event "Direct link to Adding a new event")

### Automatic Creation[​](#automatic-creation "Direct link to Automatic Creation")

Copy this prompt and paste it into your coding agent. Your agent can help you choose where the event should live, create the right folder structure, and add the first version of the event documentation.

### Manual Creation[​](#manual-creation "Direct link to Manual Creation")

Events live in a `/events` folder. This folder can be placed:

* At the root of your catalog
* Inside a specific service or domain folder

- events
  <!-- -->
  /
  * InventoryAdjusted
    <!-- -->
    /
    * index.mdx
- services
  <!-- -->
  /
  * Orders
    <!-- -->
    /
    * events
      <!-- -->
      /
      * OrderPlaced
        <!-- -->
        /
        * index.mdx

The contents are split into two sections, **frontmatter** and the **markdown content**.

*Here is an example of what a event markdown file may look like.*

/events/InventoryAdjusted/index.mdx (example)

```
---
# id of your event, used for slugs and references in EventCatalog.
id: InventoryAdjusted

# Display name of the event, rendered in EventCatalog
name: Inventory Adjusted

# Version of the event
version: 0.0.4

# Short summary of your event
summary: |
  Event with the intent to adjust the inventory

# Optional owners, references teams or users
owners:
    - dboyne

# Optional badges, rendered to UI by EventCatalog
badges:
    - content: New service
      backgroundColor: blue
      textColor: blue
---

## Overview

The `Inventory Adjusted` event represents intent to adjust the inventory of a given item.

<NodeGraph />
```

Once this file is added, the event will automatically appear across EventCatalog.

### Assign producers and consumers to your event[​](#assign-producers-and-consumers-to-your-event "Direct link to Assign producers and consumers to your event")

To add producers or consumers to your event you can read the [guide on adding messages to services](/docs/development/guides/resources/messages/connect-messages/map-producers-and-consumers.md).

You can also assign your event to one or more [channels](/docs/development/guides/resources/messages/message-channels/adding-messages-to-services.md) (e.g Kafka, RabbitMQ, AWS SQS, AWS SNS, etc).

### Adding schemas to your event[​](#adding-schemas-to-your-event "Direct link to Adding schemas to your event")

You can add any schema format to your event, you can read the [guide on adding schemas to messages](/docs/development/guides/resources/schemas/add-schemas-to-messages.md).
