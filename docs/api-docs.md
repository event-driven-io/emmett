---
outline: deep
---

# API docs

## Event

**Events are the centrepiece of event-sourced systems.** They represent both critical points of the business process but are also used as the state. That enables you to reflect your business into the code better, getting the synergy. Let's model a simple business process: a shopping cart. You can open it, add or remove the product from it and confirm or cancel.

Event type helps to keep the event definition aligned. It's not a must, but it helps to ensure that it has a type name defined (e.g. `ProductItemAddedToShoppingCart`) and read-only payload data.

You can use it as follows

<<< @/snippets/api/event.ts#event-type

The type is a simple wrapper to ensure the structure's correctness. It defines:

- **type** - event type name,
- **data** - represents the business data the event contains. It has to be a record structure; primitives are not allowed,
- **metadata** - represents the generic data event contains. It can represent telemetry, user id, tenant id, timestamps and other information that can be useful for running infrastructure. It has to be a record structure; primitives are not allowed.

See more context in [getting started guide](./getting-started.md#events)

<<< @./../packages/emmett/src/typing/event.ts

## Command

**Commands represent intention to perform business operation.** It targets a specific _audience_. It can be an application service and request with intention to “add user” or “change the order status to confirmed”. So the sender of the command must know the recipient and expects the request to be executed. Of course, the recipient may refuse to do it by not passing us the salt or throwing an exception during the request handling.

Command type helps to keep the command definition aligned. It's not a must, but it helps to ensure that it has a type name defined (e.g. `AddProductItemToShoppingCart`) and read-only payload data.

You can use it as follows

<<< @/snippets/api/command.ts#command-type

The type is a simple wrapper to ensure the structure's correctness. It defines:

- **type** - command type name,
- **data** - represents the business data the command contains. It has to be a record structure; primitives are not allowed,
- **metadata** - represents the generic data command contains. It can represent telemetry, user id, tenant id, timestamps and other information that can be useful for running infrastructure. It has to be a record structure; primitives are not allowed.

See more context in [getting started guide](./getting-started.md#commands)

<<< @./../packages/emmett/src/typing/command.ts

## Event Store

Emmett assumes the following event store structure:

<<< @./../packages/emmett/src/eventStore/eventStore.ts#event-store

## Command Handler

Emmett provides the composition around the business logic.

Using simple functions:

<<< @./../packages/emmett/src/commandHandling/handleCommand.ts#command-handler

Using decider:

<<< @./../packages/emmett/src/commandHandling/handleCommandWithDecider.ts#command-handler

You can define it for you code as:

```typescript
const handleCommand = CommandHandler<
  ShoppingCart,
  ShoppingCartCommand,
  ShoppingCartEvent
>(getEventStore, toShoppingCartStreamId, decider);
```

And call it as (using [Express.js](https://expressjs.com/) api):

```typescript
router.post(
  '/clients/:clientId/shopping-carts/:shoppingCartId/product-items',
  on(async (request: AddProductItemToShoppingCartRequest, handle) => {
    const shoppingCartId = assertNotEmptyString(request.params.shoppingCartId);

    const productId = assertNotEmptyString(request.body.productId);
    const quantity = assertPositiveNumber(request.body.quantity);

    const price = await getProductPrice(productId);

    return handle(shoppingCartId, {
      type: 'AddProductItemToShoppingCart',
      data: {
        shoppingCartId,
        productItem: {
          productId,
          quantity,
          price,
        },
      },
    });
  }),
);

type AddProductItemToShoppingCartRequest = Request<
  Partial<{ shoppingCartId: string }>,
  unknown,
  Partial<{ productId: number; quantity: number }>
>;
```
