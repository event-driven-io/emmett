import {
  MessagingAttributes,
  ObservabilityScope,
  type ObservabilityScope as ObservabilityScopeType,
  type SpanContext,
  type SpanLink,
} from '@event-driven-io/almanac';
import type { ProcessorCheckpoint } from '../../processors';
import type {
  AnyReadEventMetadata,
  Message,
  RecordedMessage,
} from '../../typing';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
  ScopeTypes,
} from '../attributes';
import type { ResolvedProcessorObservability } from '../options';

export type ProcessorCollectorContext = {
  processorId: string;
  type: string;
  checkpoint: ProcessorCheckpoint | null;
};

export const processorCollector = (
  observability: ResolvedProcessorObservability,
) => {
  const { startScope } = ObservabilityScope({
    ...observability,
    attributePrefix: 'emmett',
  });
  const A = EmmettAttributes;
  const M = MessagingAttributes;
  const processingDuration = observability.meter.histogram(
    EmmettMetrics.processor.processingDuration,
  );
  const lagEvents = observability.meter.gauge(
    EmmettMetrics.processor.lagEvents,
  );

  return {
    startScope: <
      MessageType extends Message = Message,
      MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
      T = void,
    >(
      context: ProcessorCollectorContext,
      messages: RecordedMessage<MessageType, MessageMetadataType>[],
      fn: (scope: ObservabilityScopeType) => Promise<T>,
    ): Promise<T> => {
      const sourceLinks: SpanLink[] = messages
        .filter(
          (m) =>
            (m.metadata as Record<string, unknown>)?.traceId &&
            (m.metadata as Record<string, unknown>)?.spanId,
        )
        .reduce<SpanLink[]>((acc, m) => {
          const meta = m.metadata as Record<string, unknown>;
          const link = {
            traceId: meta.traceId as string,
            spanId: meta.spanId as string,
          };
          return acc.some(
            (l) => l.traceId === link.traceId && l.spanId === link.spanId,
          )
            ? acc
            : [...acc, link];
        }, []);

      const start = Date.now();
      return startScope(
        'processor.handle',
        async (scope) => {
          scope.setAttributes({
            [A.scope.type]: ScopeTypes.processor,
            [A.processor.id]: context.processorId,
            [A.processor.type]: context.type,
            [A.processor.batchSize]: messages.length,
            [A.processor.eventTypes]: [...new Set(messages.map((m) => m.type))],
            [M.system]: MessagingSystemName,
            [M.batchMessageCount]: messages.length,
            ...(context.checkpoint
              ? { [A.processor.checkpointBefore]: context.checkpoint }
              : {}),
          });

          let status = 'success';
          try {
            const result = await fn(scope);
            status = 'success';
            return result;
          } catch (err) {
            status = 'failure';
            throw err;
          } finally {
            processingDuration.record(Date.now() - start, {
              [A.processor.id]: context.processorId,
              [A.processor.type]: context.type,
              [A.processor.status]: status,
            });
          }
        },
        { links: sourceLinks },
      );
    },

    startMessageScope: <
      MessageType extends Message = Message,
      MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
      T = void,
    >(
      context: ProcessorCollectorContext & { archetypeType: string },
      message: RecordedMessage<MessageType, MessageMetadataType>,
      batchCtx: SpanContext,
      fn: (scope: ObservabilityScopeType) => Promise<T>,
    ): Promise<T> => {
      const meta = message.metadata as Record<string, unknown>;
      const parent =
        meta?.traceId && meta?.spanId
          ? { traceId: meta.traceId as string, spanId: meta.spanId as string }
          : undefined;
      const links: SpanLink[] = batchCtx.traceId ? [batchCtx] : [];

      return startScope(
        `processor.message.${message.type}`,
        async (scope) => {
          scope.setAttributes({
            [A.scope.type]: context.archetypeType,
            [A.processor.id]: context.processorId,
            [A.processor.type]: context.type,
            [M.operationType]: 'process',
            ...(meta?.messageId
              ? { [M.messageId]: meta.messageId as string }
              : {}),
          });
          return fn(scope);
        },
        { parent, links },
      );
    },

    recordLag: (processorId: string, lag: number): void => {
      lagEvents.record(lag, { [A.processor.id]: processorId });
    },
  };
};
