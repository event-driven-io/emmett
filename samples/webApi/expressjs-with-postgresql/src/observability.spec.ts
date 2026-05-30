/**
 * End-to-end verification of the observability stack.
 *
 * Manages its own docker compose lifecycle. Run with:
 *
 *   npm run verify:observability               # auto-detect running stack
 *   npm run verify:observability -- --cleanup  # down -v first, then fresh start
 *   npm run verify:observability -- --no-start # skip docker/app startup entirely
 *
 * Containers are left running after the test for faster re-runs.
 *
 * ─── Troubleshooting log ────────────────────────────────────────────────────
 *
 * 1. OTel collector v0.150: `service.telemetry.metrics.address` removed.
 *    Fix: use `service.telemetry.metrics.readers[].pull.exporter.prometheus`.
 *
 * 2. Loki: TSDB schema requires compactor working_directory.
 *    Fix: add `common.path_prefix: /loki` to loki.yml.
 *
 * 3. Prometheus OTLP push (otlphttp/prometheus) loses the metric stream
 *    silently on any collector restart.
 *    Fix: switch to pull model — `prometheus` exporter on port 8889, add
 *    scrape job in prometheus.yml targeting otel-collector:8889.
 *
 * 4. SDK metric export interval is 60s by default. Queries return empty
 *    until the first flush. Wait >60s after first traffic.
 *
 * 5. x-trace-id header missing: installed emmett-expressjs 0.43.0-beta.15
 *    gates the header middleware behind an `observability` option not in the
 *    published types yet. Fix: wrapper Express app in src/index.ts injects
 *    the header directly via @opentelemetry/api.
 *
 * 6. PinoInstrumentation ESM hook doesn't intercept pino in tsx + Node 24.
 *    Neither log forwarding nor trace_id injection works via the SDK hook.
 *    Fix: use pino-opentelemetry-transport as a pino transport in src/index.ts.
 *    It runs in a worker thread and sends logs directly to the OTel collector.
 *
 * 7. Tempo and Loki ports (3200, 3100) not exposed in docker-compose.yml.
 *    Fix: added explicit `ports` entries to both services.
 *
 * 8. Restarting Tempo or Loki gives them new internal IPs. The OTel collector
 *    caches the old gRPC address. Fix: restart the collector after recreating
 *    any downstream service.
 *
 * 9. Stale cart state causes 400 on add-product: a confirmed/cancelled cart
 *    for the same clientId can't be reopened. Fix: randomUUID() per run.
 */

import { execa } from 'execa';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { SERVICE_NAME, URLS } from './stack';
import { waitFor } from './testing/index';
import { httpHealthCheck } from './testing/stack/healthCheck';
import { diagLoki } from './testing/stack/resources/loki';
import { diagPrometheus } from './testing/stack/resources/prometheus';
import { nodeApp } from './testing/stack/resources/nodeApp';
import {
  diagCollector,
  dockerCompose,
} from './testing/stack/tools/dockerCompose';

// ─── flags ───────────────────────────────────────────────────────────────────
// Use env vars — node --test doesn't reliably pass args after -- to process.argv.
//
//   npm run verify:observability              # auto-detect running stack
//   npm run verify:observability:cleanup      # down -v first, then fresh start
//   npm run verify:observability:cleanup:after # down -v after tests
//   npm run verify:observability:full          # down -v before AND after (CI)
//   NO_START=1 npm run verify:observability   # skip docker/app startup entirely

const CLEANUP =
  process.env['CLEANUP'] === '1' || process.env['CLEANUP'] === 'true';
const CLEANUP_AFTER =
  process.env['CLEANUP_AFTER'] === '1' ||
  process.env['CLEANUP_AFTER'] === 'true';
const NO_START =
  process.env['NO_START'] === '1' || process.env['NO_START'] === 'true';

// ─── configuration ───────────────────────────────────────────────────────────

const compose = dockerCompose({
  file: 'docker-compose.yml',
  profile: 'observability',
});

const app = nodeApp({ url: URLS.app, service: SERVICE_NAME });

// Fresh client per run — avoids stale cart state from previous runs.
const CLIENT_ID = randomUUID();
const CART_ENDPOINT = `${URLS.app}/clients/${CLIENT_ID}/shopping-carts/current/product-items`;
const CONFIRM_ENDPOINT = `${URLS.app}/clients/${CLIENT_ID}/shopping-carts/current/confirm`;

// Matches the .http file — unitPrice is resolved server-side.
const ADD_PRODUCT_BODY = JSON.stringify({
  productId: randomUUID(),
  quantity: 10,
});

// ─── state ───────────────────────────────────────────────────────────────────

let traceId: string;

// ─── diagnostic helpers ───────────────────────────────────────────────────────

async function fetchWithDiag(label: string, url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '(could not read body)');
    console.error(`\n  ✗ ${label} → HTTP ${res.status}\n  body: ${body}\n`);
  }
  return res;
}

// ─── lifecycle ────────────────────────────────────────────────────────────────

before(async () => {
  console.log(`\n▶ client ID for this run: ${CLIENT_ID}\n`);

  if (NO_START) {
    console.log('▶ --no-start: skipping docker compose and app startup');
    return;
  }

  if (CLEANUP) {
    console.log(
      '▶ --cleanup: killing port 3000 and tearing down stack (down -v)…',
    );
    await execa('bash', ['-c', 'fuser -k 3000/tcp 2>/dev/null || true']).catch(
      () => {},
    );
    await new Promise((r) => setTimeout(r, 500));
    await compose.down();
  }

  const stackReady = await fetch(`${URLS.prometheus}/-/ready`)
    .then((r) => r.ok)
    .catch(() => false);

  if (stackReady) {
    console.log(
      '▶ observability stack already up — skipping docker compose up',
    );
  } else {
    console.log('▶ starting observability stack…');
    await compose.up();
  }

  console.log('▶ waiting for backends…');
  await httpHealthCheck('Prometheus', `${URLS.prometheus}/-/ready`, {
    timeout: 90_000,
  })();
  await httpHealthCheck('Grafana', `${URLS.grafana}/api/health`, {
    timeout: 90_000,
  })();
  await httpHealthCheck('Tempo', `${URLS.tempo}/ready`, {
    timeout: 90_000,
  })();
  await httpHealthCheck('Loki', `${URLS.loki}/ready`, {
    timeout: 90_000,
  })();

  await app.up();

  console.log('▶ setup complete\n');
});

after(async () => {
  await app.down();

  if (CLEANUP_AFTER) {
    console.log('▶ tearing down stack (down -v)…');
    await compose.down();
    console.log('▶ stack torn down');
  } else {
    console.log('▶ stack is still running');
    console.log('▶ to clean up: npm run verify:observability:cleanup');
  }
});

// ─── tests ────────────────────────────────────────────────────────────────────

await test('successful command returns x-trace-id header', async () => {
  const res = await fetchWithDiag('POST add product', CART_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ADD_PRODUCT_BODY,
  });

  assert.equal(res.status, 204, `Expected 204 — body logged above`);

  const header = res.headers.get('x-trace-id');
  if (!header) {
    console.error(
      '  ✗ x-trace-id missing — verify the wrapper app in src/index.ts ' +
        'adds it via @opentelemetry/api before mounting the emmett app',
    );
  }
  assert.ok(header, 'x-trace-id header missing');
  assert.match(
    header,
    /^[0-9a-f]{32}$/,
    `"${header}" is not a 32-hex trace ID`,
  );

  traceId = header;
  console.log(`  trace ID: ${traceId}`);
});

await test('OTel collector exposes Emmett metrics on port 8889', async () => {
  // Send a few more requests so metrics are definitely recorded.
  for (let i = 0; i < 5; i++) {
    await fetch(CART_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ADD_PRODUCT_BODY,
    });
  }

  try {
    await waitFor(
      async () => {
        let text: string;
        try {
          const res = await fetch(URLS.otelCollectorMetrics);
          text = await res.text();
        } catch {
          console.log('    collector :8889: connection refused');
          return false;
        }
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
});

await test('Prometheus has scraped Emmett metrics with non-zero rate', async () => {
  // Keep sending traffic so rate() has data across scrape boundaries.
  const traffic = setInterval(() => {
    fetch(CART_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ADD_PRODUCT_BODY,
    }).catch(() => {});
  }, 3_000);

  try {
    await waitFor(
      async () => {
        const json = await fetch(
          `${URLS.prometheus}/api/v1/query?query=${encodeURIComponent(
            'sum(rate(emmett_command_handling_duration_count{service_name="expressjs-with-postgresql"}[5m]))',
          )}`,
        ).then(
          (r) =>
            r.json() as Promise<{
              data: { result: { value: [number, string] }[] };
            }>,
        );
        const value = parseFloat(json.data?.result?.[0]?.value?.[1] ?? '0');
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
    await diagPrometheus();
    await diagCollector();
    throw err;
  } finally {
    clearInterval(traffic);
  }
});

await test('Tempo received the trace with command.handle span', async () => {
  assert.ok(traceId, 'traceId not set — x-trace-id test must pass first');

  let batches: Array<{
    scopeSpans: Array<{ spans: Array<{ name: string }> }>;
  }> = [];

  try {
    await waitFor(
      async () => {
        const res = await fetch(`${URLS.tempo}/api/traces/${traceId}`);
        if (!res.ok) return false;
        const json = (await res.json()) as { batches?: typeof batches };
        batches = json.batches ?? [];
        return batches.length > 0;
      },
      { timeout: 30_000, interval: 2_000, label: `trace ${traceId} in Tempo` },
    );
  } catch (err) {
    console.error(`\n  ✗ trace not found in Tempo: ${traceId}`);
    await compose.service('otel-collector').logs(20);
    throw err;
  }

  const allSpans = batches.flatMap((b) =>
    b.scopeSpans.flatMap((s) => s.spans.map((sp) => sp.name)),
  );
  console.log(`\n  spans: ${allSpans.join(', ')}`);

  assert.ok(
    allSpans.some((name) => name === 'command.handle'),
    `No "command.handle" span found. Got: ${allSpans.join(', ')}`,
  );
});

await test('Loki received logs correlated to the service', async () => {
  // Trigger the only explicit pino log in this sample — the MessageBus handler
  // logs "Shopping Cart confirmed" via pino-opentelemetry-transport → OTel collector → Loki.
  const confirmRes = await fetchWithDiag(
    'POST confirm cart',
    CONFIRM_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  );
  console.log(`  confirm status: ${confirmRes.status}`);

  try {
    await waitFor(
      async () => {
        const query = encodeURIComponent(
          `{service_name="expressjs-with-postgresql"}`,
        );
        const now = Date.now();
        const res = await fetch(
          `${URLS.loki}/loki/api/v1/query_range?query=${query}&limit=10` +
            `&start=${(now - 300_000) * 1_000_000}&end=${now * 1_000_000}`,
        );
        const json = (await res.json()) as { data: { result: unknown[] } };
        const count = json.data?.result?.length ?? 0;
        if (count === 0) console.log('    Loki: no log streams yet');
        return count > 0;
      },
      { timeout: 30_000, interval: 3_000, label: 'logs from service in Loki' },
    );
  } catch (err) {
    await diagLoki();
    await compose.service('otel-collector').logs(15);
    throw err;
  }
});

await test('Grafana has Emmett dashboard provisioned', async () => {
  const res = await fetch(
    `${URLS.grafana}/api/search?query=Emmett&type=dash-db`,
  );
  const json = (await res.json()) as Array<{ uid: string; title: string }>;

  if (!json.some((d) => d.uid === 'emmett-observability')) {
    console.error(
      `\n  ✗ dashboard not found. Grafana returned:\n  ${JSON.stringify(json)}\n` +
        '  Check docker/observability/grafana/dashboards.yml is mounted in docker-compose.yml',
    );
  }

  assert.ok(
    json.some((d) => d.uid === 'emmett-observability'),
    'Emmett dashboard not provisioned in Grafana',
  );
});

await test('Grafana Prometheus datasource returns Emmett metric data', async () => {
  const res = await fetch(`${URLS.grafana}/api/ds/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      queries: [
        {
          datasource: { type: 'prometheus', uid: 'prometheus' },
          expr: 'sum(rate(emmett_command_handling_duration_count{service_name="expressjs-with-postgresql"}[5m]))',
          refId: 'A',
          instant: true,
        },
      ],
      from: 'now-5m',
      to: 'now',
    }),
  });

  assert.ok(res.ok, `Grafana datasource proxy returned ${res.status}`);

  const json = (await res.json()) as {
    results?: { A?: { frames?: unknown[] } };
  };
  const frames = json.results?.A?.frames ?? [];

  if (frames.length === 0) {
    console.error(
      '\n  ✗ no frames from Grafana datasource proxy\n' +
        '  Check: uid "prometheus" in docker/observability/grafana/datasources.yml\n' +
        '  and that Prometheus has emmett_* metrics (run the Prometheus test first)',
    );
    await diagPrometheus();
  }

  assert.ok(
    frames.length > 0,
    'No frames — Grafana datasource or metrics missing',
  );
});
