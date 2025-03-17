---
documentationType: reference
---

# Command

**Commands represent intention to perform business operation.** It targets a specific _audience_. It can be an application service and request with intention to “add user” or “change the order status to confirmed”. So the sender of the command must know the recipient and expects the request to be executed. Of course, the recipient may refuse to do it by not passing us the salt or throwing an exception during the request handling.

Command type helps to keep the command definition aligned. It's not a must, but it helps to ensure that it has a type name defined (e.g. `AddProductItemToShoppingCart`) and read-only payload data.

## Usage

<<< @/snippets/api/command.ts#command-type

The type is a simple wrapper to ensure the structure's correctness. It defines:

- **type** - command type name,
- **data** - represents the business data the command contains. It has to be a record structure; primitives are not allowed,
- **metadata** - represents the generic data command contains. It can represent telemetry, user id, tenant id, timestamps and other information that can be useful for running infrastructure. It has to be a record structure; primitives are not allowed.

## Definition

<<< @./../packages/emmett/src/typing/command.ts

## See also

See more context in [getting started guide](/getting-started.md#commands)
