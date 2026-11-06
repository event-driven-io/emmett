# Evolution

Records you append today will outlive the code that wrote them. A service running a newer release
still has to decode records appended by an older one.

When [validation](/kurrent-surge/schema/registration/) is on, the registry checks each new version against a
**compatibility mode** chosen when the schema was created, and rejects anything that drifts outside
it.

## Compatibility modes

Seven modes to choose from. `CompatibilityMode` carries an eighth, `Unspecified`, which is the proto
default and never a valid choice. Each mode decides which direction of readers must keep working, and
whether the check runs against the previous version only or against every version in the schema's
history.

| Mode | Reads previous | Read by previous | Checked against |
|---|---|---|---|
| `None` | n/a | n/a | no check |
| `Backward` | yes | no | previous version |
| `BackwardAll` | yes | no | every previous version |
| `Forward` | no | yes | previous version |
| `ForwardAll` | no | yes | every previous version |
| `Full` | yes | yes | previous version |
| `FullAll` | yes | yes | every previous version |

Pick one at creation time:

```csharp
await client.Registry.CreateSchema(
    "order-placed", schemaJson, SchemaDataFormat.Json, CompatibilityMode.Backward);
```

**Backward** is the right default for most event-sourced systems: new consumers must read old data,
so you may add optional fields and remove optional ones, but never add a required field.

**Forward** is the mirror. Old consumers must read new data, so you may add required fields but
never remove one they depend on.

**Full** permits only additions and removals of *optional* fields, and lets producers and consumers
upgrade in either order.

| Situation | Mode |
|---|---|
| Consumers upgrade before producers | `Backward` |
| Producers upgrade before consumers | `Forward` |
| Either side may go first | `Full` |
| Long-lived log, replays from v1 | `BackwardAll` or `FullAll` |
| Events shared across many services | `Full` or `FullAll` |
| Prototyping | `None` |

## What "required" means

The definition in the registry is a JSON Schema. A property is required when its name appears in the
top-level `required` array, and optional otherwise. Adding or removing required-ness is the core
operation the modes police.

```json
{
  "type": "object",
  "properties": {
    "orderId":  { "type": "string" },
    "product":  { "type": "string" },
    "quantity": { "type": "integer" }
  },
  "required": ["orderId", "product"]
}
```

This holds whatever the wire format is. Protobuf and Avro records register a JSON Schema too. See
[Registration](/kurrent-surge/schema/registration/).

## When a check fails

`SchemaIncompatibleException.Errors` lists every incompatibility, each naming the property path.

```csharp
try {
    await client.Registry.RegisterSchemaVersion("order-placed", v2Json);
}
catch (SchemaIncompatibleException ex) {
    foreach (var error in ex.Errors)
        Console.WriteLine("{0} at '{1}': {2}", error.Kind, error.PropertyPath, error.Details);
}
```

| Kind | Direction | Meaning |
|---|---|---|
| `MissingRequiredProperty` | backward | A required property from the old schema is gone |
| `IncompatibleTypeChange` | backward | A property's type changed incompatibly |
| `OptionalToRequired` | backward | A property became required |
| `NewRequiredProperty` | forward | A new required property old writers cannot supply |
| `RemovedProperty` | forward | A property old readers still expect is gone |
| `ArrayTypeIncompatibility` | both | Array item types are incompatible |
| `DataFormatMismatch` | both | The proposed format differs from the schema's |

To test a change without committing it, `CheckSchemaCompatibility` runs the same rules and changes
nothing.

## When to mint a new version

Version the *meaning*, not the release.

| Change | Verdict |
|---|---|
| Add an optional field with a default | stay. It is compatible |
| Add a required field | mint. Old records cannot satisfy it |
| Rename or remove a field | mint. Readers of the old shape break |
| Retype a field, or change its units | mint. Same bytes, different meaning |
| Rename the CLR class only | neither. Pin the name |

Be paranoid about enums. A new enum value is wire-compatible and still breaks every old reader that
switches over it exhaustively. Prefer strings for open sets.

## Rename a CLR type

The class moved. The records did not.

```csharp
// Class was renamed from Car to Vehicle.
[MessageType<Vehicle>("vehicle.registered")]
public record Vehicle(string RegistrationId);
```

Appended records still carry `vehicle.registered`, and consumers reading older records resolve them
to the renamed class. The registry sees no change, because the name and the shape did not change.

## Run two versions side by side

When the shape change is too big for the compatibility mode, give the new version its own schema
name. The registry treats them as independent schemas, so no check runs between them. That is the
point.

```csharp
[MessageType<OrderShippedV1>("order.shipped.v1")]
public record OrderShippedV1(string OrderId, string Carrier);

[MessageType<OrderShippedV2>("order.shipped.v2")]
public record OrderShippedV2(string OrderId, string Carrier, string TrackingNumber);
```

Project the old shape forward as you read it, so handlers only ever see the latest. Chain upcasters
version to version, so each one only knows the next hop:

```csharp
static OrderShippedV2 Upcast(OrderShippedV1 v1) =>
    new(v1.OrderId, v1.Carrier, TrackingNumber: "");

var shipped = record.Value switch {
    OrderShippedV1 v1 => Upcast(v1),
    OrderShippedV2 v2 => v2,
    _                 => null
};
```

Each historical version costs one upcast function, not one more case in every consumer.

## Prove it in CI

A round-trip test proves nothing about last year's records. It serializes today's type and
deserializes it back. Commit one serialized payload per schema version instead, and decode it against
current code on every build.

```csharp
[Test]
public async ValueTask decodes_order_shipped_v1_golden_payload() {
    // Arrange. Captured when v1 was the live contract. Never regenerate this file.
    var payload  = await File.ReadAllBytesAsync("golden/order.shipped.v1.json");
    var expected = new OrderShippedV1("7f3a", "DHL");

    // Act
    var actual = JsonSerializer.Deserialize<OrderShippedV1>(payload);

    // Assert
    await Assert.That(actual).IsEqualTo(expected);
}
```

The golden file is the contract. If a refactor breaks decoding of a committed payload, CI fails
before a replay does.

## Contracts are not domain objects

Serialize dedicated contract records, not your aggregates. The moment a domain object doubles as the
wire shape, every internal refactor becomes a contract negotiation.