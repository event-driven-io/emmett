// Single source of truth for the observability stack's endpoints and identity.
// Shared by the verification spec and (later) the dev entry point.

export const SERVICE_NAME = 'expressjs-with-postgresql';

export const URLS = {
  app: 'http://localhost:3000',
  prometheus: 'http://localhost:9090',
  tempo: 'http://localhost:3200',
  loki: 'http://localhost:3100',
  grafana: 'http://localhost:3001',
  otelCollectorMetrics: 'http://localhost:8889/metrics',
} as const;
