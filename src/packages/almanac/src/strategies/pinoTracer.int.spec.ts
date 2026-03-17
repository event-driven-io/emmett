import { describe, expect, it } from 'vitest';
import pino from 'pino';
import pinoTest from 'pino-test';
import { pinoTracer } from './pinoTracer';
import { ObservabilityScope } from '../scope';

describe('pinoTracer', () => {
  it('logs command.handle scope with all attributes on success', async () => {
    const stream = pinoTest.sink();
    const logger = pino(stream);
    const tracer = pinoTracer(logger);
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });

    await scope.startScope('command.handle', (s) => {
      s.setAttributes({
        'emmett.scope.type': 'command',
        'messaging.system': 'emmett',
        'messaging.destination.name': 'orders-stream',
        'emmett.stream.name': 'orders-stream',
      });
      s.setAttributes({
        'emmett.command.status': 'success',
        'emmett.command.event_count': 1,
        'emmett.command.event_types': ['OrderPlaced'],
        'emmett.stream.version.before': 0,
        'emmett.stream.version.after': 1,
        error: false,
      });
      return Promise.resolve();
    });

    await pinoTest.once(stream, (received: Record<string, unknown>) => {
      expect(received).toMatchObject({
        msg: 'command.handle',
        level: 30,
        'emmett.scope.main': true,
        'emmett.scope.type': 'command',
        'messaging.system': 'emmett',
        'messaging.destination.name': 'orders-stream',
        'emmett.stream.name': 'orders-stream',
        'emmett.command.status': 'success',
        'emmett.command.event_count': 1,
        'emmett.command.event_types': ['OrderPlaced'],
        'emmett.stream.version.before': 0,
        'emmett.stream.version.after': 1,
        error: false,
        status: 'success',
        durationMs: expect.any(Number) as unknown,
      });
    });
  });

  it('logs command.validated event within command.handle scope', async () => {
    const stream = pinoTest.sink();
    const logger = pino(stream);
    const tracer = pinoTracer(logger);
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });

    await scope.startScope('command.handle', (s) => {
      s.setAttributes({
        'emmett.scope.type': 'command',
        'messaging.system': 'emmett',
        'emmett.stream.name': 'orders-stream',
      });
      s.addEvent('command.validated', { 'emmett.command.type': 'PlaceOrder' });
      s.setAttributes({ 'emmett.command.status': 'success', error: false });
      return Promise.resolve();
    });

    await pinoTest.consecutive(stream, [
      (received: Record<string, unknown>) => {
        expect(received).toMatchObject({
          msg: 'command.validated',
          level: 30,
          'emmett.command.type': 'PlaceOrder',
          spanName: 'command.handle',
        });
      },
      (received: Record<string, unknown>) => {
        expect(received).toMatchObject({
          msg: 'command.handle',
          level: 30,
          'emmett.scope.main': true,
          'emmett.scope.type': 'command',
          'messaging.system': 'emmett',
          'emmett.stream.name': 'orders-stream',
          'emmett.command.status': 'success',
          error: false,
          status: 'success',
          durationMs: expect.any(Number) as unknown,
        });
      },
    ]);
  });

  it('logs command.handle failure with all exception attributes', async () => {
    const stream = pinoTest.sink();
    const logger = pino(stream);
    const tracer = pinoTracer(logger);
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });
    const error = new Error('stream version conflict');

    await expect(
      scope.startScope('command.handle', (s) => {
        s.setAttributes({
          'emmett.scope.type': 'command',
          'messaging.system': 'emmett',
          'emmett.stream.name': 'orders-stream',
        });
        s.setAttributes({
          'emmett.command.status': 'failure',
          error: true,
          'exception.message': error.message,
          'exception.type': 'Error',
        });
        s.recordException(error);
        throw error;
      }),
    ).rejects.toThrow('stream version conflict');

    await pinoTest.consecutive(stream, [
      (received: Record<string, unknown>) => {
        expect(received).toMatchObject({
          msg: 'stream version conflict',
          level: 50,
          spanName: 'command.handle',
          err: expect.objectContaining({
            message: 'stream version conflict',
          }) as unknown,
        });
      },
      (received: Record<string, unknown>) => {
        expect(received).toMatchObject({
          msg: 'command.handle',
          level: 50,
          'emmett.scope.main': true,
          'emmett.scope.type': 'command',
          'messaging.system': 'emmett',
          'emmett.stream.name': 'orders-stream',
          'emmett.command.status': 'failure',
          error: true,
          'exception.message': 'stream version conflict',
          'exception.type': 'Error',
          status: 'failure',
          durationMs: expect.any(Number) as unknown,
          err: expect.objectContaining({
            message: 'stream version conflict',
          }) as unknown,
        });
      },
    ]);
  });

  it('logs processor.handle scope with all processor attributes', async () => {
    const stream = pinoTest.sink();
    const logger = pino(stream);
    const tracer = pinoTracer(logger);
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });

    await scope.startScope('processor.handle', (s) => {
      s.setAttributes({
        'emmett.scope.type': 'processor',
        'emmett.processor.id': 'orders-processor',
        'emmett.processor.type': 'projector',
        'emmett.processor.batch_size': 2,
        'emmett.processor.event_types': ['OrderPlaced', 'OrderCancelled'],
        'messaging.system': 'emmett',
        'messaging.batch.message_count': 2,
        'emmett.processor.checkpoint.before': 10,
      });
      return Promise.resolve();
    });

    await pinoTest.once(stream, (received: Record<string, unknown>) => {
      expect(received).toMatchObject({
        msg: 'processor.handle',
        level: 30,
        'emmett.scope.main': true,
        'emmett.scope.type': 'processor',
        'emmett.processor.id': 'orders-processor',
        'emmett.processor.type': 'projector',
        'emmett.processor.batch_size': 2,
        'emmett.processor.event_types': ['OrderPlaced', 'OrderCancelled'],
        'messaging.system': 'emmett',
        'messaging.batch.message_count': 2,
        'emmett.processor.checkpoint.before': 10,
        status: 'success',
        durationMs: expect.any(Number) as unknown,
      });
    });
  });

  it('logs eventStore.readStream span with all attributes', async () => {
    const stream = pinoTest.sink();
    const logger = pino(stream);
    const tracer = pinoTracer(logger);

    await tracer.startSpan('eventStore.readStream', (span) => {
      span.setAttributes({
        'emmett.eventstore.operation': 'readStream',
        'emmett.stream.name': 'orders-stream',
        'messaging.operation.type': 'receive',
        'messaging.destination.name': 'orders-stream',
        'messaging.system': 'emmett',
      });
      span.setAttributes({
        'emmett.eventstore.read.status': 'success',
        'emmett.eventstore.read.event_count': 3,
        'emmett.eventstore.read.event_types': [
          'OrderPlaced',
          'ItemAdded',
          'OrderConfirmed',
        ],
      });
      return Promise.resolve();
    });

    await pinoTest.once(stream, (received: Record<string, unknown>) => {
      expect(received).toMatchObject({
        msg: 'eventStore.readStream',
        level: 30,
        'emmett.eventstore.operation': 'readStream',
        'emmett.stream.name': 'orders-stream',
        'messaging.operation.type': 'receive',
        'messaging.destination.name': 'orders-stream',
        'messaging.system': 'emmett',
        'emmett.eventstore.read.status': 'success',
        'emmett.eventstore.read.event_count': 3,
        'emmett.eventstore.read.event_types': [
          'OrderPlaced',
          'ItemAdded',
          'OrderConfirmed',
        ],
        status: 'success',
        durationMs: expect.any(Number) as unknown,
      });
    });
  });

  it('logs eventStore.appendToStream span with all attributes', async () => {
    const stream = pinoTest.sink();
    const logger = pino(stream);
    const tracer = pinoTracer(logger);

    await tracer.startSpan('eventStore.appendToStream', (span) => {
      span.setAttributes({
        'emmett.eventstore.operation': 'appendToStream',
        'emmett.stream.name': 'orders-stream',
        'emmett.eventstore.append.batch_size': 1,
        'messaging.operation.type': 'send',
        'messaging.batch.message_count': 1,
        'messaging.destination.name': 'orders-stream',
        'messaging.system': 'emmett',
      });
      span.setAttributes({
        'emmett.eventstore.append.status': 'success',
        'emmett.stream.version.after': 5,
      });
      return Promise.resolve();
    });

    await pinoTest.once(stream, (received: Record<string, unknown>) => {
      expect(received).toMatchObject({
        msg: 'eventStore.appendToStream',
        level: 30,
        'emmett.eventstore.operation': 'appendToStream',
        'emmett.stream.name': 'orders-stream',
        'emmett.eventstore.append.batch_size': 1,
        'messaging.operation.type': 'send',
        'messaging.batch.message_count': 1,
        'messaging.destination.name': 'orders-stream',
        'messaging.system': 'emmett',
        'emmett.eventstore.append.status': 'success',
        'emmett.stream.version.after': 5,
        status: 'success',
        durationMs: expect.any(Number) as unknown,
      });
    });
  });

  it('command.handle with nested eventStore.readStream logs child first and bubbles attributes to root', async () => {
    const stream = pinoTest.sink();
    const logger = pino(stream);
    const tracer = pinoTracer(logger);
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });

    await scope.startScope('command.handle', async (s) => {
      s.setAttributes({
        'emmett.scope.type': 'command',
        'messaging.system': 'emmett',
        'emmett.stream.name': 'orders-stream',
      });
      await s.scope('eventStore.readStream', (child) => {
        child.setAttributes({
          'emmett.eventstore.operation': 'readStream',
          'emmett.eventstore.read.event_count': 2,
        });
        return Promise.resolve();
      });
      s.setAttributes({ 'emmett.command.status': 'success', error: false });
    });

    await pinoTest.consecutive(stream, [
      (received: Record<string, unknown>) => {
        expect(received).toMatchObject({
          msg: 'eventStore.readStream',
          level: 30,
          'emmett.eventstore.operation': 'readStream',
          'emmett.eventstore.read.event_count': 2,
          status: 'success',
          durationMs: expect.any(Number) as unknown,
        });
      },
      (received: Record<string, unknown>) => {
        expect(received).toMatchObject({
          msg: 'command.handle',
          level: 30,
          'emmett.scope.main': true,
          'emmett.scope.type': 'command',
          'messaging.system': 'emmett',
          'emmett.stream.name': 'orders-stream',
          'emmett.eventstore.operation': 'readStream',
          'emmett.eventstore.read.event_count': 2,
          'emmett.command.status': 'success',
          error: false,
          status: 'success',
          durationMs: expect.any(Number) as unknown,
        });
      },
    ]);
  });

  it('addLink does not throw', async () => {
    const stream = pinoTest.sink();
    const logger = pino(stream);
    const tracer = pinoTracer(logger);

    await expect(
      tracer.startSpan('my-span', (span) => {
        span.addLink({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
        return Promise.resolve();
      }),
    ).resolves.toBeUndefined();
  });

  it('spanContext returns empty traceId and spanId', async () => {
    const stream = pinoTest.sink();
    const logger = pino(stream);
    const tracer = pinoTracer(logger);

    let ctx: { traceId: string; spanId: string } | undefined;
    await tracer.startSpan('my-span', (span) => {
      ctx = span.spanContext();
      return Promise.resolve();
    });

    expect(ctx).toEqual({ traceId: '', spanId: '' });
  });

  it('recordException with a string coerces to Error and emits pino.error', async () => {
    const stream = pinoTest.sink();
    const logger = pino(stream);
    const tracer = pinoTracer(logger);

    await tracer.startSpan('command.handle', (span) => {
      span.recordException('unexpected state');
      return Promise.resolve();
    });

    await pinoTest.consecutive(stream, [
      (received: Record<string, unknown>) => {
        expect(received).toMatchObject({
          msg: 'unexpected state',
          level: 50,
          spanName: 'command.handle',
          err: expect.objectContaining({
            message: 'unexpected state',
          }) as unknown,
        });
      },
      (received: Record<string, unknown>) => {
        expect(received).toMatchObject({
          msg: 'command.handle',
          level: 30,
          status: 'success',
          durationMs: expect.any(Number) as unknown,
        });
      },
    ]);
  });

  it('addEvent with level routes to the correct pino level', async () => {
    const stream = pinoTest.sink();
    const logger = pino({ level: 'trace' }, stream);
    const tracer = pinoTracer(logger);

    await tracer.startSpan('command.handle', (span) => {
      span.addEvent(
        'loading.state',
        { 'emmett.stream.name': 'orders-stream' },
        'debug',
      );
      span.addEvent(
        'command.validated',
        { 'emmett.command.type': 'PlaceOrder' },
        'warn',
      );
      return Promise.resolve();
    });

    await pinoTest.consecutive(stream, [
      (received: Record<string, unknown>) => {
        expect(received).toMatchObject({
          msg: 'loading.state',
          level: 20,
          'emmett.stream.name': 'orders-stream',
          spanName: 'command.handle',
        });
      },
      (received: Record<string, unknown>) => {
        expect(received).toMatchObject({
          msg: 'command.validated',
          level: 40,
          'emmett.command.type': 'PlaceOrder',
          spanName: 'command.handle',
        });
      },
      (received: Record<string, unknown>) => {
        expect(received).toMatchObject({
          msg: 'command.handle',
          level: 30,
          status: 'success',
          durationMs: expect.any(Number) as unknown,
        });
      },
    ]);
  });

  it('startSpan options are silently ignored', async () => {
    const stream = pinoTest.sink();
    const logger = pino(stream);
    const tracer = pinoTracer(logger);

    await expect(
      tracer.startSpan('my-span', () => Promise.resolve('result'), {
        parent: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
        links: [{ traceId: 'c'.repeat(32), spanId: 'd'.repeat(16) }],
        propagation: 'propagate',
      }),
    ).resolves.toBe('result');
  });
});
