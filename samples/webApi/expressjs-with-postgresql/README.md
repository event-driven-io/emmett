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

The sample ships with a full observability stack — traces (Tempo), logs (Loki), and metrics (Prometheus) — all routed through an OpenTelemetry Collector and visualised in Grafana.

### Quickstart

```bash
# 1. Start Postgres + the observability stack
docker compose --profile observability up -d

# 2. Start the app
npm start

# 3. Send a request
curl -X POST http://localhost:3000/clients/test/shopping-carts/current/product-items \
  -H 'Content-Type: application/json' \
  -d '{"productId":"p1","quantity":2}'

# 4. Open Grafana at http://localhost:3001
#    Explore → Tempo → search by service name "expressjs-with-postgresql"
```

The response includes an `x-trace-id` header with the 32-hex W3C trace ID. Copy it into Tempo's trace search to jump straight to the request.

### What you'll see in Grafana

- **Tempo**: nested spans — HTTP → Express route → pg queries → Emmett command handler
- **Loki**: pino log lines correlated with the trace; click "Logs for this trace" from a Tempo span
- **Prometheus**: `http.server.request.duration` histogram and `otelcol_receiver_accepted_spans_total` counter

### setupObservability usage modes

**Zero-config — one OTel provider:**

```ts
const { observability } = setupObservability({
  providers: { otel: setupOtel() },
});
```

**Multi-provider — typed access to each provider's native handle:**

```ts
const { observability, providers } = setupObservability({
  providers: {
    otel: setupOtel({ serviceName: 'shop' }),
  },
  sampler: rateSample(0.1),
});

providers.otel.sdk.forceFlush(); // native NodeSDK handle, fully typed
```

**Fully manual — skip the helper, pass an `ObservabilityConfig` directly:**

```ts
import { compositeTracer, otelTracer } from '@event-driven-io/almanac/otel';

const observability: ObservabilityConfig = {
  tracer: otelTracer(),
  meter: otelMeter(),
};
```

> The helpers (`setupOtel`, `setupObservability`) are the target shapes for the follow-up extraction into `@event-driven-io/almanac` and `@event-driven-io/emmett-expressjs`. A reader of this sample sees exactly the API they will import from those packages in a future release.

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
