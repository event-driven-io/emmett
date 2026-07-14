import { observability } from '@event-driven-io/almanac';
import { otel } from '@event-driven-io/almanac/otel-node';
import { setDefaultObservability } from '@event-driven-io/emmett';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';

setDefaultObservability(
  observability(
    otel({
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'expressjs-with-postgresql',
      instrumentations: [
        new HttpInstrumentation({
          ignoreIncomingRequestHook: (request) => request.url === '/health',
        }),
        new ExpressInstrumentation(),
        new PgInstrumentation(),
        new PinoInstrumentation(),
      ],
    }),
  ),
);
