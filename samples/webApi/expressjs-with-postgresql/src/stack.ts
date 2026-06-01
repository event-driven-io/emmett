// Single source of truth for the observability stack: endpoints, identity, the
// composed resource tree, and the cross-resource verifications. Shared by the
// verification spec (`observability.test()`) and the dev entry point.

import { assertOk } from '@event-driven-io/emmett';
import { randomUUID } from 'node:crypto';
import {
  stack as delorean,
  dockerCompose,
  expectResponse,
  grafana,
  loki,
  nodeWebApi,
  otelCollector,
  parallel,
  prometheus,
  sequence,
  tempo,
  verify,
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

const COMMAND_METRIC = 'emmett_command_handling_duration_count';

// ─── resource handles ─────────────────────────────────────────────────────────

const compose = dockerCompose({
  file: 'docker-compose.yml',
  profile: 'observability',
});

const CLIENT_ID = randomUUID();
const CART_PATH = `clients/${CLIENT_ID}/shopping-carts/current/product-items`;
const CONFIRM_PATH = `clients/${CLIENT_ID}/shopping-carts/current/confirm`;
const ADD_PRODUCT = { productId: randomUUID(), quantity: 10 };

console.log(`\n▶ client ID for this run: ${CLIENT_ID}\n`);
type ObservabilityContext = { traceId?: string };

export const observability = delorean({
  name: 'emmett-observability',
  resources: {
    compose: dockerCompose({
      file: 'docker-compose.yml',
      profile: 'observability',
    }),
    prom: prometheus({ url: URLS.prometheus }),
    graf: grafana({ url: URLS.grafana }),
    trc: tempo({ url: URLS.tempo }),
    log: loki({ url: URLS.loki }),
    collector: otelCollector({
      url: URLS.otelCollectorMetrics,
      logs: (lines) => compose.service('otel-collector').logs(lines),
    }),
    api: nodeWebApi({ url: URLS.app, service: SERVICE_NAME }),
  },
  pipeline: (r) =>
    sequence(
      r.compose,
      parallel(r.prom, r.graf, r.trc, r.log, r.collector),
      r.api,
    ),
  context: (): ObservabilityContext => ({ traceId: undefined }),
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
  verify: ({ api, prom, graf, trc, log, collector }, context) => [
    verify('successful command returns x-trace-id header', async () => {
      const res = await api.http.post(CART_PATH, ADD_PRODUCT);
      await expectResponse(res, 204, {
        headers: { 'x-trace-id': /^[0-9a-f]{32}$/ },
      });

      context.traceId = res.headers.get('x-trace-id')!;
      console.log(`  trace ID: ${context.traceId}`);
    }),
    verify('OTel collector exposes Emmett metrics on port 8889', async () => {
      // Send a few more requests so metrics are definitely recorded.
      for (let i = 0; i < 5; i++) await api.http.post(CART_PATH, ADD_PRODUCT);

      try {
        await collector.metrics.waitFor('emmett_', { timeout: 90_000 });
      } catch (err) {
        await collector.diagnose('emmett_');
        await collector.logs();
        throw err;
      }
    }),
    verify(
      'Prometheus has scraped Emmett metrics with non-zero rate',
      async () => {
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
    ),
    verify('Tempo received the trace with command.handle span', async () => {
      assertOk(
        context.traceId,
        'traceId not set — x-trace-id check must run first',
      );

      try {
        const spans = await trc.traces.waitForSpan(
          context.traceId,
          'command.handle',
          {
            timeout: 30_000,
          },
        );
        console.log(`\n  spans: ${spans.join(', ')}`);
      } catch (err) {
        console.error(`\n  ✗ trace not found in Tempo: ${context.traceId}`);
        await collector.logs(20);
        throw err;
      }
    }),
    verify('Loki received logs correlated to the service', async () => {
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
    }),
    verify('Grafana has Emmett dashboard provisioned', async () => {
      const dashboards = await graf.api.searchDashboards('Emmett');
      const found = dashboards.some((d) => d.uid === 'emmett-observability');
      if (!found)
        console.error(
          `\n  ✗ dashboard not found. Grafana returned:\n  ${JSON.stringify(dashboards)}\n` +
            '  Check docker/observability/grafana/dashboards.yml is mounted in docker-compose.yml',
        );
      assertOk(found, 'Emmett dashboard not provisioned in Grafana');
    }),
    verify(
      'Grafana Prometheus datasource returns Emmett metric data',
      async () => {
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
    ),
  ],
});
