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
    await given({ propagation: 'links' })
      .when(async (config) => {
        const r = reactor({
          processorId: 'test',
          eachMessage: () => Promise.resolve(),
          observability: config,
        });
        await r.start({});
        await r.handle(
          [
            makeMessage('OrderPlaced', {
              traceId: 'trace-A',
              spanId: 'span-x',
            }),
          ],
          {},
        );
        await r.close({});
      })
      .then(({ spans }) =>
        spans
          .haveSpanNamed('processor.message.OrderPlaced')
          .hasParent({ traceId: 'trace-A', spanId: 'span-x' }),
      );
  });

  it('root span carries source links from message trace context', async () => {
    await given({ propagation: 'links' })
      .when(async (config) => {
        const r = reactor({
          processorId: 'test',
          eachMessage: () => Promise.resolve(),
          observability: config,
        });
        await r.start({});
        await r.handle(
          [
            makeMessage('OrderPlaced', {
              traceId: 'trace-A',
              spanId: 'span-x',
            }),
          ],
          {},
        );
        await r.close({});
      })
      .then(({ spans }) =>
        spans
          .haveSpanNamed('processor.handle')
          .hasCreationLinks([{ traceId: 'trace-A', spanId: 'span-x' }]),
      );
  });

  it('per-message span without trace context has no parent', async () => {
    await given({ propagation: 'links' })
      .when(async (config) => {
        const r = reactor({
          processorId: 'test',
          eachMessage: () => Promise.resolve(),
          observability: config,
        });
        await r.start({});
        await r.handle([makeMessage('OrderPlaced')], {});
        await r.close({});
      })
      .then(({ spans }) =>
        spans.haveSpanNamed('processor.message.OrderPlaced').hasNoParent(),
      );
  });

  it("per-message span forwards propagation: 'propagate' in StartSpanOptions when configured", async () => {
    await given({ propagation: 'propagate' })
      .when(async (config) => {
        const r = reactor({
          processorId: 'test',
          eachMessage: () => Promise.resolve(),
          observability: config,
        });
        await r.start({});
        await r.handle(
          [
            makeMessage('OrderPlaced', {
              traceId: 'trace-A',
              spanId: 'span-x',
            }),
          ],
          {},
        );
        await r.close({});
      })
      .then(({ spans }) =>
        spans
          .haveSpanNamed('processor.message.OrderPlaced')
          .hasPropagation('propagate')
          .hasParent({ traceId: 'trace-A', spanId: 'span-x' }),
      );
  });

  it('per-message span has emmett.scope.main: true', async () => {
    await given({ propagation: 'links' })
      .when(async (config) => {
        const r = reactor({
          processorId: 'test',
          eachMessage: () => Promise.resolve(),
          observability: config,
        });
        await r.start({});
        await r.handle([makeMessage('OrderPlaced')], {});
        await r.close({});
      })
      .then(({ spans }) =>
        spans
          .haveSpanNamed('processor.message.OrderPlaced')
          .hasAttribute('emmett.scope.main', true),
      );
  });

  it("per-message span has emmett.scope.type: 'reactor' for a reactor processor", async () => {
    await given({ propagation: 'links' })
      .when(async (config) => {
        const r = reactor({
          processorId: 'test',
          eachMessage: () => Promise.resolve(),
          observability: config,
        });
        await r.start({});
        await r.handle([makeMessage('OrderPlaced')], {});
        await r.close({});
      })
      .then(({ spans }) =>
        spans
          .haveSpanNamed('processor.message.OrderPlaced')
          .hasAttribute('emmett.scope.type', 'reactor'),
      );
  });
});
