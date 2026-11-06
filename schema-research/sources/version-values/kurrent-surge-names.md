# Schema Names

Every record carries a schema name. Readers resolve it to a CLR type; the registry keys on it. It
shows up in tooling, in cross-service contracts, and in every consumer written in another language.

**Schema names are append-only.** Once a record carries a name, readers of that record exist forever,
so a name can never be reused for a different shape. It can only be retired. Picking well up front
is cheap. Retrofitting is not.

## Resolution order

Every declaration resolves its name the same way:

1. **A pinned name**, the string on the attribute or the `Map` call
2. **A strategy**, on the declaration or on the namespace scan that picked the type up
3. **The default convention**, the full CLR type name

```csharp
[MessageType<OrderPlaced>("order.placed.v1")]   // 1. pinned
[MessageType<OrderShipped, AcmeNames>]          // 2. strategy
[MessageType<OrderCancelled>]                   // 3. convention
```

There is no client-wide strategy. Each registration carries its own naming source, so one client can
speak several conventions at once. That is what makes migrating between them possible.

## Strategies

Two ship, and each composes with an output format.

| Strategy | Inputs | Output | Choose when |
|---|---|---|---|
| **Type name** (default) | the type | `{Namespace}.{TypeName}` | Prototyping, internal systems, code as contract |
| **Fixed namespace** | type + a label | `{label}.{TypeName}` | Decoupling the wire from code structure; multi-tenant or environment isolation |

```csharp
public sealed class AcmeNames() : NamespaceSchemaNameStrategy("acme", SchemaNameOutputFormat.KebabCase);

[MessageType<OrderShipped, AcmeNames>]   // acme.order-shipped
public record OrderShipped(string OrderId);
```

The strategy is compile-checked. It must implement `ISchemaNameStrategy` and have a parameterless
constructor, or the attribute does not compile. A one-line named subclass gives the configuration a
home.

On a catalog or the options, pass it per mapping:

```csharp
opts.Messages
    .MapMessage<OrderPlaced>(SchemaNameStrategies.Namespace("acme", SchemaNameOutputFormat.KebabCase))
    .MapMessage<OrderCancelled>("order.cancelled.v1");   // pinned, bypasses any strategy
```

## Output formats

The second axis. It transforms casing, and applies the same way whichever strategy produced the
prefix.

| Format | Result for `Shop.Orders.OrderPlaced` |
|---|---|
| `None` (default) | `Shop.Orders.OrderPlaced` |
| `KebabCase` | `shop.orders.order-placed` |
| `SnakeCase` | `shop.orders.order_placed` |
| `Urn` | `urn:schemas-kurrent:shop.orders:order-placed` |

## The default convention is a trap for long-lived contracts

`{Namespace}.{TypeName}` ties the wire contract to your code structure. Rename the class, or move it
to another namespace, and the schema name changes. That breaks every consumer reading the old name.

That is fine for a prototype. For anything that outlives a refactor, pin the name or use a fixed
namespace.

Name records after the domain, not the code. `Shop.Orders.OrderPlaced` couples the wire to your
assembly layout. `order.order-placed` survives any refactor and reads as the domain.

## Version from day one

Put a version in the name before the first record is written.

```csharp
.Map<OrderPlaced>("order.order-placed")     // the first rename will be a breaking one
.Map<OrderPlaced>("order.order-placed.v1")  // the first rename is already priced in
```

The unversioned name is the one contract you cannot fix cheaply: adding `.v1` later is itself a
rename, and renames are the expensive move. One suffix at design time buys every future migration.
When the shape genuinely changes, `order.order-placed.v2` slots in beside v1 and both decode side by
side.

## Consistency beats cleverness

A simple convention applied uniformly carries further than a sophisticated one applied unevenly.
Review a catalog change the way you review a public API change, because that is what it is.