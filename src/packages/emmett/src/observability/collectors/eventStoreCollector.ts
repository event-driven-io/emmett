import { MessagingAttributes } from '@event-driven-io/almanac';
import type { AnyReadEventMetadata, Event, ReadEvent } from '../../typing';
import type { AppendToStreamResult, ReadStreamResult } from '../../eventStore';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
} from '../attributes';
import type { ResolvedEventStoreObservability } from '../options';

export const eventStoreCollector = (
  observability: ResolvedEventStoreObservability,
) => {
  const A = EmmettAttributes;
  const M = MessagingAttributes;
  const streamReadingDuration = observability.meter.histogram(
    EmmettMetrics.stream.readingDuration,
  );
  const streamReadingSize = observability.meter.histogram(
    EmmettMetrics.stream.readingSize,
  );
  const eventReadingCount = observability.meter.counter(
    EmmettMetrics.event.readingCount,
  );
  const streamAppendingDuration = observability.meter.histogram(
    EmmettMetrics.stream.appendingDuration,
  );
  const streamAppendingSize = observability.meter.histogram(
    EmmettMetrics.stream.appendingSize,
  );
  const eventAppendingCount = observability.meter.counter(
    EmmettMetrics.event.appendingCount,
  );

  return {
    instrumentRead: <
      EventType extends Event,
      ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
    >(
      streamName: string,
      fn: () => Promise<ReadStreamResult<EventType, ReadEventMetadataType>>,
    ): Promise<ReadStreamResult<EventType, ReadEventMetadataType>> => {
      const start = Date.now();
      return observability.tracer.startSpan(
        'eventStore.readStream',
        async (span) => {
          span.setAttributes({
            [A.eventStore.operation]: 'readStream',
            [A.stream.name]: streamName,
            [M.operationType]: 'receive',
            [M.destinationName]: streamName,
            [M.system]: MessagingSystemName,
          });

          let status = 'success';
          try {
            const result = await fn();
            const events: ReadEvent<EventType, ReadEventMetadataType>[] =
              result.events;
            status = 'success';
            span.setAttributes({
              [A.eventStore.read.status]: status,
              [A.eventStore.read.eventCount]: events.length,
              [A.eventStore.read.eventTypes]: [
                ...new Set(events.map((e) => e.type)),
              ],
            });
            streamReadingSize.record(events.length, {
              [A.eventStore.read.status]: status,
            });
            for (const event of events) {
              eventReadingCount.add(1, { [A.event.type]: event.type });
            }
            return result;
          } catch (err) {
            status = 'failure';
            span.setAttributes({ [A.eventStore.read.status]: status });
            throw err;
          } finally {
            streamReadingDuration.record(Date.now() - start, {
              [A.eventStore.read.status]: status,
            });
          }
        },
      );
    },

    instrumentAppend: <
      Result extends AppendToStreamResult,
      EventType extends Event = Event,
    >(
      streamName: string,
      events: EventType[],
      fn: () => Promise<Result>,
    ): Promise<Result> => {
      const start = Date.now();
      return observability.tracer.startSpan(
        'eventStore.appendToStream',
        async (span) => {
          span.setAttributes({
            [A.eventStore.operation]: 'appendToStream',
            [A.stream.name]: streamName,
            [A.eventStore.append.batchSize]: events.length,
            [M.operationType]: 'send',
            [M.batchMessageCount]: events.length,
            [M.destinationName]: streamName,
            [M.system]: MessagingSystemName,
          });

          let status = 'success';
          try {
            const result = await fn();
            status = 'success';
            span.setAttributes({
              [A.eventStore.append.status]: status,
              [A.stream.versionAfter]: Number(result.nextExpectedStreamVersion),
            });
            streamAppendingSize.record(events.length, {
              [A.eventStore.append.status]: status,
            });
            for (const event of events) {
              eventAppendingCount.add(1, { [A.event.type]: event.type });
            }
            return result;
          } catch (err) {
            status = 'failure';
            span.setAttributes({ [A.eventStore.append.status]: status });
            throw err;
          } finally {
            streamAppendingDuration.record(Date.now() - start, {
              [A.eventStore.append.status]: status,
            });
          }
        },
      );
    },
  };
};
