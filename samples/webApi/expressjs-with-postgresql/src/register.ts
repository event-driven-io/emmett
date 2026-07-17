import { EmmettInstrumentation } from '@event-driven-io/emmett/otel';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

const traceExporter = new OTLPTraceExporter({
  url: `${otlpEndpoint}/v1/traces`,
});

const logExporter = new OTLPLogExporter({
  url: `${otlpEndpoint}/v1/logs`,
});

const metricExporter = new OTLPMetricExporter({
  url: `${otlpEndpoint}/v1/metrics`,
});

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'expressjs-with-postgresql',
  spanProcessors: [new BatchSpanProcessor(traceExporter)],
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: logExporter })],
  metricReader: new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 5_000,
  }),
  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (request) => request.url === '/health',
    }),
    new ExpressInstrumentation(),
    new PgInstrumentation(),
    new PinoInstrumentation(),
    new EmmettInstrumentation(),
  ],
});

sdk.start();
