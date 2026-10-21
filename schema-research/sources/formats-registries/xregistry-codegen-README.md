# xRegistry Code Generation CLI

[![Python Test](https://github.com/xregistry/codegen/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/xregistry/codegen/actions/workflows/test.yml)
[![Python Release](https://github.com/xregistry/codegen/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/xregistry/codegen/actions/workflows/build.yml)

Generate production-ready, type-safe messaging SDKs from [xRegistry](https://xregistry.io/) message catalog definitions. One command gives you compile-ready producer/consumer code with tests, dependency management, and protocol-specific bindings.

## Quick Start

**1. Install** (Docker or pip):

```bash
# Docker (recommended - no Python needed)
docker pull ghcr.io/xregistry/codegen/xrcg:latest

# Or via pip
pip install git+https://github.com/xregistry/codegen.git
```

**2. Generate a Kafka producer** from a sample definition:

```bash
# Using Docker (Linux/macOS)
docker run --rm -v $(pwd):/work ghcr.io/xregistry/codegen/xrcg:latest \
  generate --projectname PrinterEvents --language py --style kafkaproducer \
  --definitions https://raw.githubusercontent.com/xregistry/codegen/main/samples/message-definitions/inkjet.xreg.json \
  --output ./generated
```

```powershell
# Using Docker (Windows PowerShell)
docker run --rm -v ${PWD}:/work ghcr.io/xregistry/codegen/xrcg:latest `
  generate --projectname PrinterEvents --language py --style kafkaproducer `
  --definitions https://raw.githubusercontent.com/xregistry/codegen/main/samples/message-definitions/inkjet.xreg.json `
  --output ./generated
```

```bash
# Or with pip install (any platform)
xrcg generate --projectname PrinterEvents --language py --style kafkaproducer \
  --definitions https://raw.githubusercontent.com/xregistry/codegen/main/samples/message-definitions/inkjet.xreg.json \
  --output ./generated
```

This produces a complete Python project with:

- Type-safe producer classes for each message type
- Strongly-typed data classes generated from Avro schema
- Integration tests using Testcontainers
- Ready to use: `cd generated && pip install -e . && pytest`

**3. Or generate for a different platform** — same definition, different target:

```bash
xrcg generate --projectname ContosoEvents --language cs --style ehproducer \
  --definitions ./contoso-erp.xreg.json --output ./generated   # C# Event Hubs

xrcg generate --projectname ContosoEvents --language ts --style mqttclient \
  --definitions ./contoso-erp.xreg.json --output ./generated   # TypeScript MQTT

xrcg generate --projectname ContosoEvents --language py --style kafkaconsumer \
  --definitions ./contoso-erp.xreg.json --output ./generated   # Python Kafka
```

## What You Get

Unlike snippet generators, this tool produces **complete SDK-like projects**:

| Feature | What's Generated |
|---------|------------------|
| **Type-safe clients** | Producer/consumer classes with strongly-typed methods per message |
| **Data classes** | Schema-derived classes via [Avrotize](https://github.com/clemensv/avrotize) (JSON Schema, Avro, Protobuf) |
| **Build files** | `pom.xml`, `.csproj`, `package.json`, `pyproject.toml` with correct dependencies |
| **Integration tests** | Docker-based tests using Testcontainers for Kafka, MQTT, AMQP brokers |
| **Project structure** | Language-idiomatic layout ready for IDE import |

**Supported Languages:** Java 21+, C# (.NET 6+), Python 3.9+, TypeScript/JavaScript, Go 1.21+, Rust (cargo)

**Supported Protocols:** Apache Kafka, MQTT 5.0, AMQP 1.0, Azure Event Hubs, Azure Service Bus, Azure Event Grid, HTTP/CloudEvents

## Generating Code

For complete command documentation, see [Command Reference](docs/commands/README.md).

### The Generate Command

```bash
xrcg generate --projectname <name> --language <lang> --style <style> \
  --definitions <file-or-url> --output <dir>
```

| Option | Description |
|--------|-------------|
| `--projectname` | Project/namespace name for generated code |
| `--language` | Target language: `java`, `cs`, `py`, `ts`, `asyncapi`, `openapi` |
| `--style` | Protocol binding: `kafkaproducer`, `ehconsumer`, `mqttclient`, etc. |
| `--definitions` | Path or URL to xRegistry JSON/YAML definition |
| `--output` | Output directory (will be created/overwritten) |
| `--templates` | Custom template directory (optional) |
| `--template-args` | Extra args as `key=value` (optional) |

### Available Templates

Run `xrcg list` to see all available language/style combinations:

```text
├── java: Java 21+
│   ├── kafkaproducer, kafkaconsumer     # Apache Kafka
│   ├── ehproducer, ehconsumer           # Azure Event Hubs  
│   ├── sbproducer, sbconsumer           # Azure Service Bus
│   ├── amqpproducer, amqpconsumer       # AMQP 1.0 (RabbitMQ 4+, Artemis, Qpid)
│   └── mqttclient                       # MQTT 5.0
├── cs: C# / .NET 6.0+
│   ├── kafkaproducer, kafkaconsumer
│   ├── ehproducer, ehconsumer, ehazfn   # Event Hubs + Azure Functions
│   ├── sbproducer, sbconsumer, sbazfn
│   ├── egproducer, egazfn               # Event Grid
│   ├── amqpproducer, amqpconsumer
│   └── mqttclient
├── py: Python 3.9+
│   ├── kafkaproducer, kafkaconsumer
│   ├── ehproducer, ehconsumer
│   └── mqttclient
├── ts: TypeScript
│   ├── kafkaproducer, kafkaconsumer
│   ├── ehproducer, ehconsumer
│   ├── sbproducer, sbconsumer
│   ├── egproducer, amqpproducer, amqpconsumer
│   └── mqttclient
├── asyncapi: AsyncAPI 3.0 definitions
└── openapi: OpenAPI 3.0 definitions
```

### Protocol-Specific Examples

<details>
<summary><strong>AMQP 1.0 (RabbitMQ, Artemis, Qpid)</strong></summary>

```bash
# Generate Java producer
xrcg generate --language java --style amqpproducer \
  --projectname MyProducer --definitions ./catalog.json --output ./out

# Generate C# consumer  
xrcg generate --language cs --style amqpconsumer \
  --projectname MyConsumer --definitions ./catalog.json --output ./out
```

See [RabbitMQ AMQP 1.0 Setup Guide](docs/rabbitmq_amqp_setup.md) for broker configuration.

</details>

<details>
<summary><strong>AsyncAPI / OpenAPI Generation</strong></summary>

```bash
# Generate AsyncAPI producer definition
xrcg generate --language asyncapi --style producer \
  --projectname MyAPI --definitions ./catalog.json --output ./out

# With binary CloudEvents mode
xrcg generate --language asyncapi --style producer \
  --projectname MyAPI --definitions ./catalog.json --output ./out \
  --template-args ce_content_mode=binary

# Generate OpenAPI for HTTP producer
xrcg generate --language openapi --style producer \
  --projectname MyAPI --definitions ./catalog.json --output ./out
```

</details>

### Custom Templates

Override built-in templates or add new language/style combinations:

```bash
xrcg generate --templates ./my-templates --language java --style myproducer ...
```

Template directory structure mirrors the built-in templates. See [Authoring Templates](docs/authoring_templates.md).

## Installation Details

### Docker (Recommended)

```bash
docker pull ghcr.io/xregistry/codegen/xrcg:latest
```

Create a shell alias for convenience:

```bash
# Linux/macOS (.bashrc or .zshrc)
alias xrcg='docker run --rm -v $(pwd):/work ghcr.io/xregistry/codegen/xrcg:latest'

# Windows PowerShell (profile)
function xrcg { docker run --rm -v ${PWD}:/work ghcr.io/xregistry/codegen/xrcg:latest $args }
```

> **Note:** File paths must be relative to your current directory due to Docker volume mapping.

### Python Package

Requires Python 3.10+:

```bash
pip install git+https://github.com/xregistry/codegen.git
```

For development setup, see [Development Environment](docs/development_environment.md).

## Working with xRegistry Definitions

The generator consumes [xRegistry](https://xregistry.io/) message catalog documents—JSON/YAML files that describe schemas, messages, and endpoints. You can:

- Use existing definition files (see [samples/message-definitions/](samples/message-definitions/))
- Create definitions manually following the [xRegistry spec](https://github.com/xregistry/spec)
- Manage definitions using the CLI's `manifest` or `catalog` commands

### Sample Definitions

| Sample | Description |
|--------|-------------|
| [contoso-erp.xreg.json](samples/message-definitions/contoso-erp.xreg.json) | ERP system events (orders, payments, inventory) |
| [fabrikam-motorsports.xreg.json](samples/message-definitions/fabrikam-motorsports.xreg.json) | Motorsports telemetry stream |
| [inkjet.xreg.json](samples/message-definitions/inkjet.xreg.json) | IoT printer events |

### Managing Definitions with CLI

<details>
<summary><strong>Manifest Mode (Local Files)</strong></summary>

Work with local JSON files for version-controlled, offline workflows:

```bash
# Create a message group
xrcg manifest messagegroup add --manifest=./catalog.json --id=orders --envelope=CloudEvents/1.0

# Add a message definition
xrcg manifest message add --manifest=./catalog.json --messagegroupid=orders \
  --id=OrderPlaced --description="Order was placed"

# Validate the file
xrcg validate --definitions ./catalog.json
```

</details>

<details>
<summary><strong>Catalog Mode (Remote Registry)</strong></summary>

Interact with a remote xRegistry HTTP API for team collaboration:

```bash
# Configure registry connection
xrcg config set registry.base_url https://registry.example.com
xrcg config set registry.auth_token <token>

# Work with remote registry
xrcg catalog messagegroup add --id=orders ...
xrcg catalog message list --messagegroupid=orders
```

Currently supports [xrserver](https://github.com/xregistry/xrserver/) registry.

</details>

### Validate Command

Check definition files for errors:

```bash
xrcg validate --definitions ./catalog.json
xrcg validate --definitions https://example.com/catalog.json
```

### Configuration

Store defaults to avoid repetition:

```bash
xrcg config set defaults.language java
xrcg config set defaults.output_dir ./generated
xrcg config list
```

Config location: `~/.config/xrcg/config.json` (Linux), `%APPDATA%\xrcg\config.json` (Windows)

## What is xRegistry?

[xRegistry](https://xregistry.io/) is a CNCF project defining a standard format for describing messaging and eventing infrastructure. A message catalog document contains:

- **Schema groups** — Payload schemas (JSON Schema, Avro, Protobuf)
- **Message groups** — Message definitions with [CloudEvents](https://cloudevents.io) envelope metadata
- **Endpoints** — Protocol bindings (Kafka topics, AMQP queues, HTTP endpoints)

The code generator follows references between these elements to produce cohesive, type-safe SDKs.

## Community

- **Slack:** [#cloudevents on CNCF Slack](http://slack.cncf.io/)
- **Mailing list:** [cncf-cloudevents@lists.cncf.io](https://lists.cncf.io/g/cncf-cloudevents)
- **Governance:** [GOVERNANCE.md](https://github.com/xregistry/spec/blob/main/docs/GOVERNANCE.md)
- **Contributing:** [CONTRIBUTING.md](https://github.com/xregistry/spec/blob/main/docs/CONTRIBUTING.md)

## License

[Apache 2.0](LICENSE)
