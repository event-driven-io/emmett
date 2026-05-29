import { ObservabilitySpec } from '@event-driven-io/almanac';
import { describe, it } from 'vitest';
import type { AnyRecordedMessageMetadata } from '../typing';
import { reactor } from './processors';

const makeMessage = (type: string, meta: Record<string, unknown> = {}) => ({
  type,
  data: {},
  kind: 'Event' as const,
  metadata: meta as unknown as AnyRecordedMessageMetadata,
});

const given = ObservabilitySpec.for();

describe('processors observability wiring', () => {
  it('per-message span uses trace context from message metadata as parent', async () => {
    await given((config) =>
      reactor({
        processorId: 'test',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.handle(
          [
            makeMessage('OrderPlaced', {
              traceId: 'trace-A',
              spanId: 'span-x',
            }),
          ],
          {},
        );
        await reactor.close({});
      })
      .then(({ spans }) =>
        spans
          .haveSpanNamed('processor.message.OrderPlaced')
          .hasParent({ traceId: 'trace-A', spanId: 'span-x' }),
      );
  });

  it('per-message span without trace context has no parent', async () => {
    await given((config) =>
      reactor({
        processorId: 'test',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.handle([makeMessage('OrderPlaced')], {});
        await reactor.close({});
      })
      .then(({ spans }) =>
        spans.haveSpanNamed('processor.message.OrderPlaced').hasNoParent(),
      );
  });

  it('root span carries source links from message trace context by default', async () => {
    await given((config) =>
      reactor({
        processorId: 'test',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.handle(
          [
            makeMessage('OrderPlaced', {
              traceId: 'trace-A',
              spanId: 'span-x',
            }),
          ],
          {},
        );
        await reactor.close({});
      })
      .then(({ spans }) =>
        spans
          .haveSpanNamed('processor.handle')
          .hasCreationLinks([{ traceId: 'trace-A', spanId: 'span-x' }]),
      );
  });

  it("per-message span forwards propagation: 'propagate' in StartSpanOptions when configured", async () => {
    await given(
      (config) =>
        reactor({
          processorId: 'test',
          eachMessage: () => Promise.resolve(),
          observability: config,
        }),
      { propagation: 'propagate' as const },
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.handle(
          [
            makeMessage('OrderPlaced', {
              traceId: 'trace-A',
              spanId: 'span-x',
            }),
          ],
          {},
        );
        await reactor.close({});
      })
      .then(({ spans }) =>
        spans
          .haveSpanNamed('processor.message.OrderPlaced')
          .hasPropagation('propagate')
          .hasParent({ traceId: 'trace-A', spanId: 'span-x' }),
      );
  });
});
