# Event

**Events are the centrepiece of event-sourced systems.** They represent both critical points of the business process but are also used as the state. That enables you to reflect your business into the code better, getting the synergy. Let's model a simple business process: a shopping cart. You can open it, add or remove the product from it and confirm or cancel.

Event type helps to keep the event definition aligned. It's not a must, but it helps to ensure that it has a type name defined (e.g. `ProductItemAddedToShoppingCart`) and read-only payload data.

## Usage
You can use it as follows

<<< @/snippets/api/event.ts#event-type

The type is a simple wrapper to ensure the structure's correctness. It defines:

- **type** - event type name,
- **data** - represents the business data the event contains. It has to be a record structure; primitives are not allowed,
- **metadata** - represents the generic data event contains. It can represent telemetry, user id, tenant id, timestamps and other information that can be useful for running infrastructure. It has to be a record structure; primitives are not allowed.


## See also
Find more context in [getting started guide](/getting-started.md#events)

<<< @./../packages/emmett/src/typing/event.ts
