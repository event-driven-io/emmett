import type {
  LogAttributes,
  LogEvent,
  LogEventMetadata,
} from '../loggers/logger';
import type { SpanContext } from './span';

export const logEventForSpan = <
  EventName extends string,
  Attributes extends LogAttributes,
>(
  event: LogEvent<EventName, Attributes>,
  context: SpanContext,
): LogEvent<EventName, Attributes> => {
  const traceId = event.metadata.traceId ?? context.traceId;
  const spanId = event.metadata.spanId ?? context.spanId;

  if (traceId === event.metadata.traceId && spanId === event.metadata.spanId)
    return event;

  const metadata: LogEventMetadata = {
    ...event.metadata,
    traceId,
    spanId,
  };

  return {
    name: event.name,
    data: event.data,
    metadata,
  };
};
