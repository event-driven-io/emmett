[![](https://dcbadge.vercel.app/api/server/fTpqUTMmVa?style=flat)](https://discord.gg/fTpqUTMmVa) [<img src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" height="20px" />](https://www.linkedin.com/in/oskardudycz/) [![Github Sponsors](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&link=https://github.com/sponsors/event-driven-io)](https://github.com/sponsors/event-driven-io) [![blog](https://img.shields.io/badge/blog-event--driven.io-brightgreen)](https://event-driven.io/?utm_source=event_sourcing_nodejs) [![blog](https://img.shields.io/badge/%F0%9F%9A%80-Architecture%20Weekly-important)](https://www.architecture-weekly.com/?utm_source=event_sourcing_nodejs)

![](./docs/public/logo.png)

# Emmett - Sample showing event-sourced WebApi with Express.js and PostgreSQL

Read more in [Emmett getting started guide](https://event-driven-io.github.io/emmett/getting-started.html).

## Prerequisities

Sample require PostgreSQL, you can start it by running

```bash
docker-compose up
```

You need to install packages with

```bash
npm install
```

## Running

Just run

```bash
npm run start
```

## Observability

Emmett auto-instruments your application with zero configuration: every command execution, event store read/write, processor, consumer, and workflow emits spans, metrics, and structured logs via OpenTelemetry.

This sample bundles a turnkey observability stack — OTel Collector → Tempo (traces) / Loki (logs) / Prometheus (metrics) → Grafana — so you can explore all three signals out of the box.

### Quickstart

```bash
# 1. Start Postgres + the observability stack
docker compose --profile observability up -d

# 2. Start the app
npm start

# 3. Send a request
curl -i -X POST http://localhost:3000/clients/dummy/shopping-carts/current/product-items \
  -H 'Content-Type: application/json' \
  -d '{"productId":"dummy","quantity":10}'

# 4. Open Grafana at http://localhost:3001
```

### Endpoints

| Service    | URL                   | What it shows                            |
| ---------- | --------------------- | ---------------------------------------- |
| App        | http://localhost:3000 | REST API                                 |
| Grafana    | http://localhost:3001 | Dashboards, trace explorer, log explorer |
| Prometheus | http://localhost:9090 | Raw metrics, PromQL                      |
| Tempo      | http://localhost:3200 | Trace storage (query via Grafana)        |
| Loki       | http://localhost:3100 | Log storage (query via Grafana)          |
| pgAdmin    | http://localhost:5050 | PostgreSQL browser                       |

### Traces — Tempo

Every HTTP response includes an `x-trace-id` header with the 32-hex W3C trace ID.

```bash
curl -si -X POST http://localhost:3000/clients/dummy/shopping-carts/current/product-items \
  -H 'Content-Type: application/json' \
  -d '{"productId":"dummy","quantity":10}' | grep x-trace-id
# x-trace-id: 2bcdc8bd2f7854bbac8a1f50d460d6af
```

Paste that ID into Grafana → Explore → Tempo to jump straight to the request. Expected span tree:

```
HTTP POST /clients/dummy/shopping-carts/current/product-items
└── command.handle                            ← Emmett command handler
    ├── eventStore.readStream                 ← (when wired — see event store note)
    ├── eventStore.appendToStream             ← (when wired)
    └── pg.query SELECT / INSERT              ← auto-instrumented PostgreSQL
```

Key attributes on the `command.handle` span:

| Attribute                          | Example value                        |
| ---------------------------------- | ------------------------------------ |
| `emmett.scope.type`                | `command`                            |
| `emmett.stream.name`               | `shopping_cart-dummy`                |
| `emmett.command.status`            | `success` / `failure`                |
| `emmett.command.event_count`       | `1`                                  |
| `emmett.command.event_types`       | `["ProductItemAddedToShoppingCart"]` |
| `emmett.stream.version.before`     | `0`                                  |
| `emmett.stream.version.after`      | `1`                                  |
| `messaging.system`                 | `emmett`                             |
| `messaging.message.correlation_id` | (propagated if present)              |

### Logs — Loki

Pino log lines are forwarded to Loki via the OTel SDK and include `trace_id` and `span_id`. In Grafana, the Loki datasource has a "View Trace" derived field so you can jump from any log line to the corresponding trace in Tempo.

To search logs for a specific trace:

```
{service_name="expressjs-with-postgresql"} |= "<trace-id>"
```

### Metrics — Prometheus and Grafana

#### Pre-built dashboard

Open Grafana → Dashboards → **Emmett** folder → **Emmett** dashboard. It has three active sections and three collapsed sections for when you enable more Emmett features:

**Overview** — command throughput (req/s), success rate (%), p95 latency (ms), events emitted/s

**Command Handling** — command rate split by success/failure, latency p50/p95/p99 over time, events emitted per type

**HTTP** — HTTP request rate and response latency percentiles from the auto-instrumented Express layer

**Event Store, Processors, Consumers, Workflows** — collapsed by default with a note explaining which Emmett component to wire up to populate each section

#### Metric reference

| Metric                                 | Type           | Labels                                         | Description                                         |
| -------------------------------------- | -------------- | ---------------------------------------------- | --------------------------------------------------- |
| `emmett_command_handling_duration`     | histogram (ms) | `emmett_command_status`, `emmett_command_type` | Command handler execution time                      |
| `emmett_event_appending_count_total`   | counter        | `emmett_event_type`                            | Events written per type                             |
| `emmett_stream_reading_duration`       | histogram (ms) | `emmett_stream_name`                           | Stream read time (requires `eventStoreCollector`)   |
| `emmett_stream_appending_duration`     | histogram (ms) | `emmett_stream_name`                           | Stream append time (requires `eventStoreCollector`) |
| `emmett_processor_processing_duration` | histogram (ms) | `emmett_processor_id`                          | Processor batch time (requires consumer framework)  |
| `emmett_processor_lag_events`          | gauge          | `emmett_processor_id`                          | Events behind tail (requires consumer framework)    |

### What's instrumented in this sample

Only `commandHandlerCollector` is wired here. The others exist in Emmett but need to be enabled:

| Collector                 | Status                                | Metrics prefix                                 | Span names                                           |
| ------------------------- | ------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `commandHandlerCollector` | **active**                            | `emmett.command.*`, `emmett.event.appending.*` | `command.handle`                                     |
| `eventStoreCollector`     | not wired in this sample              | `emmett.stream.*`, `emmett.event.reading.*`    | `eventStore.readStream`, `eventStore.appendToStream` |
| `processorCollector`      | not wired (uses in-memory MessageBus) | `emmett.processor.*`                           | `processor.handle`                                   |
| `consumerCollector`       | not wired                             | `emmett.consumer.*`                            | `consumer.poll`                                      |
| `workflowCollector`       | not wired                             | `emmett.workflow.*`                            | `workflow.handle`                                    |

### Customising

The observability setup lives in [src/register.ts](src/register.ts). It uses the standard OpenTelemetry environment variables, including `OTEL_SERVICE_NAME` and `OTEL_EXPORTER_OTLP_ENDPOINT`; application-specific instrumentations are passed directly to `otel()`.

## Running inside Docker

To build application:

```bash
docker-compose --profile app build
```

To run application:

```bash
docker-compose --profile app up
```

### Testing

You can either run tests with

```
npm run test
```

Or manually with prepared [.http](.http) file
