// Single source of truth for the observability stack: endpoints, identity, the
// composed resource tree, and the cross-resource verifications. Shared by the
// verification spec (`observability.test()`) and the dev entry point.

import { assertOk } from '@event-driven-io/emmett';
import { randomUUID } from 'node:crypto';
import { waitFor } from './testing/index';
import {
  dockerCompose,
  expectResponse,
  fetchText,
  grafana,
  loki,
  nodeApp,
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

// ─── resource handles ─────────────────────────────────────────────────────────

const compose = dockerCompose({
  file: 'docker-compose.yml',
  profile: 'observability',
});
const prom = prometheus({ url: URLS.prometheus });
const graf = grafana({ url: URLS.grafana, service: SERVICE_NAME });
const trc = tempo({ url: URLS.tempo });
const log = loki({ url: URLS.loki });
const app = nodeApp({ url: URLS.app, service: SERVICE_NAME });

export const resources = { compose, prom, graf, trc, log, app };

// ─── per-run client + payloads ──────────────────────────────────────────────
// Fresh client per run — avoids stale cart state from previous runs.

const CLIENT_ID = randomUUID();
const CART_PATH = `clients/${CLIENT_ID}/shopping-carts/current/product-items`;
const CONFIRM_PATH = `clients/${CLIENT_ID}/shopping-carts/current/confirm`;

// Matches the .http file — unitPrice is resolved server-side.
const ADD_PRODUCT = { productId: randomUUID(), quantity: 10 };

console.log(`\n▶ client ID for this run: ${CLIENT_ID}\n`);

// ─── cross-resource state + diagnostics ─────────────────────────────────────

let traceId: string;

async function diagCollector() {
  const text = await fetchText(URLS.otelCollectorMetrics).catch(
    () => 'unreachable',
  );
  const emmett = text
    .split('\n')
    .filter((l) => l.startsWith('emmett_') && !l.startsWith('#'))
    .slice(0, 5);
  console.log(
    emmett.length
      ? `\n  collector /metrics (emmett lines):\n  ${emmett.join('\n  ')}`
      : '\n  collector /metrics: no emmett_* lines found',
  );
}

// ─── the stack ──────────────────────────────────────────────────────────────
// Cross-resource verifications (app traffic, the traceId flow, the collector view)
// live on the stack; the self-contained Grafana checks live on the Grafana resource.

export const observability = stack({
  name: 'emmett-observability',
  resources: [sequence(compose, parallel(prom, graf, trc, log), app)],
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
        const res = await app.post(CART_PATH, ADD_PRODUCT);
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
        for (let i = 0; i < 5; i++) await app.post(CART_PATH, ADD_PRODUCT);

        try {
          await waitFor(
            async () => {
              const text = await fetchText(URLS.otelCollectorMetrics).catch(
                () => {
                  console.log('    collector :8889: connection refused');
                  return '';
                },
              );
              const emmettLines = text
                .split('\n')
                .filter((l) => l.startsWith('emmett_') && !l.startsWith('#'));
              if (emmettLines.length === 0) {
                const allFamilies = [
                  ...new Set(
                    text
                      .split('\n')
                      .filter((l) => !l.startsWith('#') && l)
                      .map((l) => l.split('{')[0]),
                  ),
                ].slice(0, 5);
                console.log(
                  `    collector :8889: no emmett_* metrics yet. Present: ${allFamilies.join(', ') || '(none)'}`,
                );
                return false;
              }
              return true;
            },
            {
              timeout: 90_000,
              interval: 5_000,
              label: 'emmett metrics on collector :8889',
            },
          );
        } catch (err) {
          await diagCollector();
          await compose.service('otel-collector').logs();
          throw err;
        }
      },
    },
    scrapedMetrics: {
      name: 'Prometheus has scraped Emmett metrics with non-zero rate',
      verify: async () => {
        // Keep sending traffic so rate() has data across scrape boundaries.
        const traffic = setInterval(() => {
          void app.post(CART_PATH, ADD_PRODUCT).catch(() => {});
        }, 3_000);

        try {
          await waitFor(
            async () => {
              const value = await prom.queryInstant(
                `sum(rate(emmett_command_handling_duration_count{service_name="${SERVICE_NAME}"}[5m]))`,
              );
              if (value > 0) return true;
              console.log(`    rate = ${value} — waiting for non-zero…`);
              return false;
            },
            {
              timeout: 120_000,
              interval: 5_000,
              label: 'non-zero command rate in Prometheus',
            },
          );
        } catch (err) {
          await prom.diagnose();
          await diagCollector();
          throw err;
        } finally {
          clearInterval(traffic);
        }
      },
    },
    tempoSpan: {
      name: 'Tempo received the trace with command.handle span',
      verify: async () => {
        assertOk(traceId, 'traceId not set — x-trace-id test must pass first');

        let spans: string[] = [];
        try {
          await waitFor(
            async () => {
              spans = await trc.getSpans(traceId);
              return spans.length > 0;
            },
            {
              timeout: 30_000,
              interval: 2_000,
              label: `trace ${traceId} in Tempo`,
            },
          );
        } catch (err) {
          console.error(`\n  ✗ trace not found in Tempo: ${traceId}`);
          await compose.service('otel-collector').logs(20);
          throw err;
        }

        console.log(`\n  spans: ${spans.join(', ')}`);
        assertOk(
          spans.some((name) => name === 'command.handle'),
          `No "command.handle" span found. Got: ${spans.join(', ')}`,
        );
      },
    },
    lokiCorrelated: {
      name: 'Loki received logs correlated to the service',
      verify: async () => {
        // Trigger the only explicit pino log in this sample — the MessageBus handler
        // logs "Shopping Cart confirmed" via pino-opentelemetry-transport → OTel collector → Loki.
        const confirmRes = await app.post(CONFIRM_PATH);
        console.log(`  confirm status: ${confirmRes.status}`);

        try {
          await waitFor(
            async () => {
              const count = await log.queryRange(
                `{service_name="${SERVICE_NAME}"}`,
              );
              if (count === 0) console.log('    Loki: no log streams yet');
              return count > 0;
            },
            {
              timeout: 30_000,
              interval: 3_000,
              label: 'logs from service in Loki',
            },
          );
        } catch (err) {
          await log.diagnose();
          await compose.service('otel-collector').logs(15);
          throw err;
        }
      },
    },
  }),
});
