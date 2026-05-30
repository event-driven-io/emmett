/**
 * End-to-end verification of the observability stack.
 *
 * Manages its own docker compose lifecycle. Run with:
 *
 *   npm run verify:observability               # up, verify, then close
 *   npm run verify:observability:cleanup       # down -v first and after (fresh CI run)
 *   NO_START=1 npm run verify:observability    # verify a running stack, leave it up
 *
 * The stack, its resources, and the verifications all live in src/stack.ts.
 * `observability.test()` brings the tree up, gates on each healthCheck, runs every
 * verification as a node:test test, then closes — except under NO_START, where it
 * verifies a stack it didn't start and leaves it running. Lifecycle flags resolve by
 * precedence: env CLEANUP / NO_START map onto the stack's clean / noStart options.
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

import { observability } from './stack';

await observability.test();
