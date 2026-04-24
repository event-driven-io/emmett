import { setupObservability, setupOtel } from './telemetry';

const { shutdown } = setupObservability({ providers: { otel: setupOtel() } });

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
