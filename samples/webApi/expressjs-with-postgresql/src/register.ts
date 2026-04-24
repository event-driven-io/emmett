import { setupObservability, setupOtel } from './telemetry';

export const { observability, shutdown } = setupObservability({
  providers: { otel: setupOtel() },
});

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
