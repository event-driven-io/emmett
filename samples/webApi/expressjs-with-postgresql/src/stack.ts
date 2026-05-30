// Single source of truth for the observability stack: endpoints, identity, the
// composed resource tree, and the cross-resource verifications. Shared by the
// verification spec (`observability.test()`) and the dev entry point.

import { assertOk } from '@event-driven-io/emmett';
import { randomUUID } from 'node:crypto';
import {
  dockerCompose,
  expectResponse,
  grafana,
  loki,
  nodeWebApi,
  otelCollector,
  parallel,
  prometheus,
  sequence,
  stack,
  tempo,
  verifications,
} from './testing/stack';

export const SERVICE_NAME = 'expressjs-with-postgresql';

export const URLS = {
  app: 'http://localhost:3000',
  prometheus: 'http://localhost:9090',
  tempo: 'http://localhost:3200',
  loki: 'http://localhost:3100',
  grafana: 'http://localhost:3001',
  otelCollectorMetrics: 'http://localhost:8889/metrics',
} as const;

// The Emmett metric whose non-zero rate proves commands are being handled + scraped.
const COMMAND_METRIC = 'emmett_command_handling_duration_count';

// ─── resource handles ─────────────────────────────────────────────────────────

const compose = dockerCompose({
  file: 'docker-compose.yml',
  profile: 'observability',
});
const prom = prometheus({ url: URLS.prometheus });
const graf = grafana({ url: URLS.grafana });
const trc = tempo({ url: URLS.tempo });
const log = loki({ url: URLS.loki });
const collector = otelCollector({
  url: URLS.otelCollectorMetrics,
  logs: (lines) => compose.service('otel-collector').logs(lines),
});
const api = nodeWebApi({ url: URLS.app, service: SERVICE_NAME });

export const resources = {
  compose,
  prom,
  graf,
  trc,
  log,
  collector,
  api,
};

// ─── per-run client + payloads ──────────────────────────────────────────────
// Fresh client per run — avoids stale cart state from previous runs.

const CLIENT_ID = randomUUID();
const CART_PATH = `clients/${CLIENT_ID}/shopping-carts/current/product-items`;
const CONFIRM_PATH = `clients/${CLIENT_ID}/shopping-carts/current/confirm`;

// Matches the .http file — unitPrice is resolved server-side.
const ADD_PRODUCT = { productId: randomUUID(), quantity: 10 };

console.log(`\n▶ client ID for this run: ${CLIENT_ID}\n`);

let traceId: string;

// ─── the stack ──────────────────────────────────────────────────────────────
// Cross-resource verifications (app traffic, the traceId flow) live on the stack;
// each backend owns the parsing/polling behind an intention-revealing method, so
// these read as intent. The self-contained Grafana checks live on the Grafana resource.

export const observability = stack({
  name: 'emmett-observability',
  resources: [
    sequence(compose, parallel(prom, graf, trc, log, collector), api),
  ],
  renderer: 'listr',
  dashboard: {
    title: 'Emmett observability stack is up',
    endpoints: {
      App: URLS.app,
      Grafana: URLS.grafana,
      Prometheus: URLS.prometheus,
      Tempo: URLS.tempo,
      Loki: URLS.loki,
    },
    tips: [
      'every command response carries an x-trace-id header — paste it into Tempo.',
      'Ctrl-C tears the stack down.',
    ],
  },
  verify: verifications({
    returnsTraceId: {
      name: 'successful command returns x-trace-id header',
      verify: async () => {
        const res = await api.http.post(CART_PATH, ADD_PRODUCT);
        await expectResponse(res, 204, {
          headers: { 'x-trace-id': /^[0-9a-f]{32}$/ },
        });

        traceId = res.headers.get('x-trace-id')!;
        console.log(`  trace ID: ${traceId}`);
      },
    },
    collectorMetrics: {
      name: 'OTel collector exposes Emmett metrics on port 8889',
      verify: async () => {
        // Send a few more requests so metrics are definitely recorded.
        for (let i = 0; i < 5; i++) await api.http.post(CART_PATH, ADD_PRODUCT);

        try {
          await collector.metrics.waitFor('emmett_', { timeout: 90_000 });
        } catch (err) {
          await collector.diagnose('emmett_');
          await collector.logs();
          throw err;
        }
      },
    },
    scrapedMetrics: {
      name: 'Prometheus has scraped Emmett metrics with non-zero rate',
      verify: async () => {
        // Keep sending traffic so rate() has data across scrape boundaries.
        const stop = api.http.traffic({
          method: 'POST',
          path: CART_PATH,
          body: ADD_PRODUCT,
        });
        try {
          await prom.metrics.waitForNonZeroRate(COMMAND_METRIC, {
            service: SERVICE_NAME,
            timeout: 120_000,
          });
        } catch (err) {
          await prom.diagnose('emmett_');
          await collector.diagnose('emmett_');
          throw err;
        } finally {
          stop();
        }
      },
    },
    tempoSpan: {
      name: 'Tempo received the trace with command.handle span',
      verify: async () => {
        assertOk(traceId, 'traceId not set — x-trace-id test must pass first');

        try {
          const spans = await trc.traces.waitForSpan(
            traceId,
            'command.handle',
            {
              timeout: 30_000,
            },
          );
          console.log(`\n  spans: ${spans.join(', ')}`);
        } catch (err) {
          console.error(`\n  ✗ trace not found in Tempo: ${traceId}`);
          await collector.logs(20);
          throw err;
        }
      },
    },
    lokiCorrelated: {
      name: 'Loki received logs correlated to the service',
      verify: async () => {
        // Trigger the only explicit pino log in this sample — the MessageBus handler
        // logs "Shopping Cart confirmed" via pino-opentelemetry-transport → OTel collector → Loki.
        const confirmRes = await api.http.post(CONFIRM_PATH);
        console.log(`  confirm status: ${confirmRes.status}`);

        try {
          await log.logs.waitForService(SERVICE_NAME, { timeout: 30_000 });
        } catch (err) {
          await log.diagnose();
          await collector.logs(15);
          throw err;
        }
      },
    },
    grafanaDashboard: {
      name: 'Grafana has Emmett dashboard provisioned',
      verify: async () => {
        const dashboards = await graf.api.searchDashboards('Emmett');
        const found = dashboards.some((d) => d.uid === 'emmett-observability');
        if (!found)
          console.error(
            `\n  ✗ dashboard not found. Grafana returned:\n  ${JSON.stringify(dashboards)}\n` +
              '  Check docker/observability/grafana/dashboards.yml is mounted in docker-compose.yml',
          );
        assertOk(found, 'Emmett dashboard not provisioned in Grafana');
      },
    },
    grafanaDatasource: {
      name: 'Grafana Prometheus datasource returns Emmett metric data',
      verify: async () => {
        const { ok, status, frames } = await graf.api.queryDatasource(
          'prometheus',
          `sum(rate(${COMMAND_METRIC}{service_name="${SERVICE_NAME}"}[5m]))`,
        );
        assertOk(ok, `Grafana datasource proxy returned ${status}`);
        if (frames.length === 0)
          console.error(
            '\n  ✗ no frames from Grafana datasource proxy\n' +
              '  Check: uid "prometheus" in docker/observability/grafana/datasources.yml\n' +
              '  and that Prometheus has emmett_* metrics (run the Prometheus test first)',
          );
        assertOk(
          frames.length > 0,
          'No frames — Grafana datasource or metrics missing',
        );
      },
    },
  }),
});
