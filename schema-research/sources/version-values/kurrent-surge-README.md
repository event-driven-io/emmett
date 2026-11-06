# Kurrent Surge

[![CI](https://github.com/kurrent-io/kurrent-surge/actions/workflows/ci.yml/badge.svg)](https://github.com/kurrent-io/kurrent-surge/actions/workflows/ci.yml)
[![NuGet](https://img.shields.io/nuget/v/Kurrent.Surge.svg)](https://www.nuget.org/packages/Kurrent.Surge)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Kurrent Surge is the .NET SDK for [KurrentDB](https://kurrent.io) and the Kurrent Platform. It
replaces the v1 `KurrentDB.Client` packages and the EventStoreDB clients before them.

The v1 client was a transport. It moved bytes to a stream and back. Everything above that was yours
to build: schema names, serialization, checkpoints, reconnection, batching. Kurrent Surge keeps that
surface and ships the layers most applications ended up writing themselves.

Kurrent Surge infers nothing. Each schema name, each codec, and each mapping is something you
declared and the compiler checked.

## Install

```shell
dotnet add package Kurrent.Surge
```

Needs .NET 10.0 or a subsequent version and KurrentDB 24.10 or a subsequent version.

## Quick start

Declare a catalog for your message types. The client reads it to map each CLR type to a schema name.

```csharp
using Kurrent.Surge.Client;
using Kurrent.Surge.Schema.Catalogs;

[assembly: MessageCatalog("Orders.Events", AlwaysActive = true)]

await using var client = KurrentClient.Create("kurrentdb://localhost:2113?tls=false");

var records = new[] { AppendRecord.Create(new OrderPlaced("order-123")) };
var result  = await client.Streams.AppendStream("orders-123", records, ExpectedStreamState.NoStream);

await foreach (var message in client.Streams.ReadStream("orders-123")) {
    if (message.Value is Record record)
        Console.WriteLine(record.Value);
}

namespace Orders.Events {
    public record OrderPlaced(string OrderId);
}
```

## Features

- **Streams** — append, read, subscribe to, and manage streams
- **Schema registry** — register a schema, get it, and check its compatibility
- **Indexes and connectors** — create, start, stop, and delete them
- **Filter expressions** — SQL filters over stream, category, schema name, metadata and JSON payload
- **Codecs** — JSON, Protobuf and Avro are all built in
- **Stream processing** — processors with checkpointing, batching, back-off and graceful shutdown
- **OpenTelemetry** — distributed tracing and metrics
- **Dependency injection** — first-class `IServiceCollection` integration
- **Native AOT** — source generators, no reflection

## Documentation

The documentation site is at [kurrent-io.github.io/kurrent-surge](https://kurrent-io.github.io/kurrent-surge/).

- [Getting started](https://kurrent-io.github.io/kurrent-surge/getting-started/)
- [What is Kurrent Surge](https://kurrent-io.github.io/kurrent-surge/what-is-surge/)
- [Streams](https://kurrent-io.github.io/kurrent-surge/streams/) — append, read, filter, manage
- [Processors](https://kurrent-io.github.io/kurrent-surge/processors/) — stream processing with checkpoints
- [Schema](https://kurrent-io.github.io/kurrent-surge/schema/) — catalogs, formats, the registry
- [Configuring the client](https://kurrent-io.github.io/kurrent-surge/client/configuring-the-client/) —
  connection strings, security, clusters

## Examples

[`examples/`](./examples) holds runnable projects, from a minimal program to full processors
against Postgres and Redis. Each has its own README.

## Contributing

See the [Contributing Guide](CONTRIBUTING.md). For questions and help, see [SUPPORT.md](SUPPORT.md).

## Community

- [Discord](https://discord.gg/Phn9pmCw3t)
- [Discussions](https://github.com/kurrent-io/kurrent-surge/discussions)

## License

Apache License 2.0. See [LICENSE](LICENSE.md).
