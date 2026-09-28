import {
  assertThatSpan,
  assertThatSpans,
  LogEvent,
  ObservabilityScope,
  ObservabilitySpec,
  testObservabilityContextGenerator,
} from '@event-driven-io/almanac';
import { describe, it } from 'vitest';
import { EmmettError } from '../errors';
import { getInMemoryEventStore, type EventStore } from '../eventStore';
import {
  EmmettAttributes,
  EmmettSpans,
  MessagingSystemName,
} from '../observability/attributes';
import { withOperationScope } from '../observability/options';
import { assertDeepEqual } from '../testing';
import type {
  AnyMessage,
  AnyRecordedMessageMetadata,
  MessageHandlerContext,
} from '../typing';
import { ProcessorCheckpoint } from './checkpoints';
import { reactor } from './processors';

const A = EmmettAttributes;
const M = {
  system: 'messaging.system',
  batchMessageCount: 'messaging.batch.message_count',
  operationType: 'messaging.operation.type',
};

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
      .then(({ spans }) => {
        spans.hasSingleSpanNamed('processor.handle').hasAttributes({
          [A.scope.type]: 'processor',
          [A.scope.main]: true,
          [A.processor.id]: 'test',
          [A.processor.type]: 'reactor',
          [A.processor.batchSize]: 1,
          [A.processor.eventTypes]: ['OrderPlaced'],
          [A.processor.status]: 'ack',
          [M.system]: MessagingSystemName,
          [M.batchMessageCount]: 1,
        });

        spans
          .hasSingleSpanNamed('processor.message.OrderPlaced')
          .hasParent({ traceId: 'trace-A', spanId: 'span-x' })
          .hasAttributes({
            [A.scope.type]: 'reactor',
            [A.processor.id]: 'test',
            [A.processor.type]: 'reactor',
            [M.operationType]: 'process',
          });
      });
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
        spans
          .hasSingleSpanNamed('processor.message.OrderPlaced')
          .hasNoParent()
          .hasAttributes({
            [A.scope.type]: 'reactor',
            [A.processor.id]: 'test',
            [A.processor.type]: 'reactor',
            [M.operationType]: 'process',
          }),
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
          .hasSingleSpanNamed('processor.handle')
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
          .hasSingleSpanNamed('processor.message.OrderPlaced')
          .hasPropagation('propagate')
          .hasParent({ traceId: 'trace-A', spanId: 'span-x' })
          .hasAttributes({
            [A.scope.type]: 'reactor',
            [A.processor.id]: 'test',
            [A.processor.type]: 'reactor',
            [M.operationType]: 'process',
          }),
      );
  });

  it('the message store on the handler context appends into the handled message flow', async () => {
    const eventStore = getInMemoryEventStore({
      observability: {
        contextGenerator: testObservabilityContextGenerator({
          traceIds: 'store-trace',
          spanIds: 'store-span',
          messageIds: 'appended-message',
        }),
      },
    });
    const streamName = 'reaction-2';
    let metadata: AnyRecordedMessageMetadata | undefined;

    await given((config) =>
      reactor<
        AnyMessage,
        AnyRecordedMessageMetadata,
        MessageHandlerContext<
          Record<never, never>,
          { messageStore: EventStore }
        >
      >({
        processorId: 'test',
        eachMessage: async (_message, context) => {
          await context.session.messageStore.appendToStream(streamName, [
            { type: 'OrderConfirmed', kind: 'Event', data: {} },
          ]);
        },
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({ session: { messageStore: eventStore } });
        await reactor.handle(
          [
            makeMessage('OrderPlaced', {
              messageId: 'trigger-message',
              correlationId: 'flow-1',
            }),
          ],
          { session: { messageStore: eventStore } },
        );
        await reactor.close({ session: { messageStore: eventStore } });

        const { events } = await eventStore.readStream(streamName);
        metadata = events[0]?.metadata;
      })
      .then(() => {
        const { messageId, correlationId, causationId } = metadata!;

        assertDeepEqual(
          { messageId, correlationId, causationId },
          {
            messageId: 'appended-message',
            correlationId: 'flow-1',
            causationId: 'trigger-message',
          },
        );
      });
  });

  it('what a reactor appends is caused by the message it handles', async () => {
    const eventStore = getInMemoryEventStore({
      observability: {
        contextGenerator: testObservabilityContextGenerator({
          traceIds: 'store-trace',
          spanIds: 'store-span',
          messageIds: 'appended-message',
        }),
      },
    });
    const streamName = 'reaction-1';
    let metadata: AnyRecordedMessageMetadata | undefined;

    await given((config) =>
      reactor({
        processorId: 'test',
        eachMessage: async (_message, context) => {
          await eventStore.appendToStream(
            streamName,
            [{ type: 'OrderConfirmed', kind: 'Event', data: {} }],
            { observability: withOperationScope(context.observabilityScope) },
          );
        },
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.handle(
          [
            makeMessage('OrderPlaced', {
              messageId: 'trigger-message',
              correlationId: 'flow-1',
            }),
          ],
          {},
        );
        await reactor.close({});

        const { events } = await eventStore.readStream(streamName);
        metadata = events[0]?.metadata;
      })
      .then(() => {
        const { messageId, correlationId, causationId } = metadata!;

        assertDeepEqual(
          { messageId, correlationId, causationId },
          {
            messageId: 'appended-message',
            correlationId: 'flow-1',
            causationId: 'trigger-message',
          },
        );
      });
  });
});

describe('processor start observability', () => {
  const S = EmmettSpans.processor;
  const processorIds = {
    [A.processor.id]: 'orders',
    [A.processor.instanceId]: 'orders-1',
    [A.processor.type]: 'reactor',
  };

  it('starting a processor opens an emmett.processor.start span with processor ids', async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        processorInstanceId: 'orders-1',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when((reactor) => reactor.start({}))
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.start)
          .hasNoParent()
          .hasAttributes({ ...processorIds, [A.scope.main]: true }),
      );
  });

  it('starting a processor logs one Processor started at info with start_from BEGINNING', async () => {
    const started = {
      ...processorIds,
      [A.processor.startFrom]: 'BEGINNING',
      [A.processor.checkpoint]: undefined,
    };

    await given((config) =>
      reactor({
        processorId: 'orders',
        processorInstanceId: 'orders-1',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when((reactor) => reactor.start({}))
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.start)
          .hasAttributes(started)
          .logged('info', 'Processor started', started)
          .loggedCount(2),
      );
  });

  it('starting a processor from END logs Processor started with start_from END', async () => {
    const started = {
      ...processorIds,
      [A.processor.startFrom]: 'END',
      [A.processor.checkpoint]: undefined,
    };

    await given((config) =>
      reactor({
        processorId: 'orders',
        processorInstanceId: 'orders-1',
        eachMessage: () => Promise.resolve(),
        startFrom: 'END',
        observability: config,
      }),
    )
      .when((reactor) => reactor.start({}))
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.start)
          .hasAttributes(started)
          .logged('info', 'Processor started', started)
          .loggedCount(2),
      );
  });

  it('starting a processor from an explicit checkpoint logs Processor started with start_from explicit and the checkpoint', async () => {
    const checkpoint = ProcessorCheckpoint('42');
    const started = {
      ...processorIds,
      [A.processor.startFrom]: 'explicit',
      [A.processor.checkpoint]: checkpoint,
    };

    await given((config) =>
      reactor({
        processorId: 'orders',
        processorInstanceId: 'orders-1',
        eachMessage: () => Promise.resolve(),
        startFrom: { lastCheckpoint: checkpoint },
        observability: config,
      }),
    )
      .when((reactor) => reactor.start({}))
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.start)
          .hasAttributes(started)
          .logged('info', 'Processor started', started)
          .loggedCount(2),
      );
  });

  it('starting a processor from a stored checkpoint logs Processor started with start_from checkpoint and the checkpoint', async () => {
    const checkpoint = ProcessorCheckpoint('42');
    const started = {
      ...processorIds,
      [A.processor.startFrom]: 'checkpoint',
      [A.processor.checkpoint]: checkpoint,
    };

    await given((config) =>
      reactor({
        processorId: 'orders',
        processorInstanceId: 'orders-1',
        eachMessage: () => Promise.resolve(),
        checkpoints: {
          read: () => Promise.resolve({ lastCheckpoint: checkpoint }),
          store: () => Promise.resolve({ success: true, newCheckpoint: null }),
        },
        observability: config,
      }),
    )
      .when((reactor) => reactor.start({}))
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.start)
          .hasAttributes(started)
          .logged('info', 'Processor started', started)
          .loggedCount(2),
      );
  });

  it('lifecycle details are logged at debug', async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        processorInstanceId: 'orders-1',
        eachMessage: () => Promise.resolve(),
        lock: {
          lock: {
            tryAcquire: () => Promise.resolve(true),
            release: () => Promise.resolve(),
          },
        },
        hooks: { onStart: () => Promise.resolve() },
        observability: config,
      }),
    )
      .when((reactor) => reactor.start({}))
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.start)
          .logged('debug', 'Starting processor', processorIds)
          .logged('debug', 'Acquiring processor lock', processorIds)
          .logged('debug', 'Running processor onStart hook', processorIds)
          .logged('info', 'Processor started')
          .loggedCount(4),
      );
  });

  it("the start span is a child of the caller's scope when one is given", async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        processorInstanceId: 'orders-1',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when((reactor, config) =>
        ObservabilityScope(config).startScope('caller', (scope) =>
          reactor.start({ observabilityScope: scope }),
        ),
      )
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.start)
          .hasParentSpanNamed('caller')
          .logged('info', 'Processor started'),
      );
  });

  it('a second start while active logs at debug and opens no new processing', async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        processorInstanceId: 'orders-1',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when(async (reactor, config) => {
        await reactor.start({});
        const position = await reactor.start({});

        return {
          position,
          startSpans: config.tracer.spans.filter((s) => s.name === S.start),
        };
      })
      .then(({ result: { position, startSpans } }) => {
        assertDeepEqual(position, undefined);
        assertDeepEqual(startSpans.length, 2);
        assertThatSpan(startSpans[1])
          .logged('debug', 'Processor already active', processorIds)
          .loggedCount(1);
      });
  });
});

describe('processor start steps observability', () => {
  const S = EmmettSpans.processor;
  const lock = {
    tryAcquire: () => Promise.resolve(true),
    release: () => Promise.resolve(),
  };

  it('lock acquisition runs in an acquire_lock span under the start span', async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        eachMessage: () => Promise.resolve(),
        lock: {
          lock: {
            ...lock,
            tryAcquire: (context) => {
              context.observabilityScope.log(LogEvent.debug('lock attempt'));
              return Promise.resolve(true);
            },
          },
        },
        observability: config,
      }),
    )
      .when((reactor) => reactor.start({}))
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.acquireLock)
          .hasParentSpanNamed(S.start)
          .logged('debug', 'lock attempt')
          .loggedCount(1),
      );
  });

  it('the onStart hook runs in a hooks.on_start span and receives that scope', async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        eachMessage: () => Promise.resolve(),
        hooks: {
          onStart: (context) => {
            context.observabilityScope.log(LogEvent.info('hook ran'));
            return Promise.resolve();
          },
        },
        observability: config,
      }),
    )
      .when((reactor) => reactor.start({}))
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.onStart)
          .hasParentSpanNamed(S.start)
          .logged('info', 'hook ran')
          .loggedCount(1),
      );
  });

  it('reading the checkpoint runs in a read_checkpoint span carrying the checkpoint', async () => {
    const checkpoint = ProcessorCheckpoint('42');

    await given((config) =>
      reactor({
        processorId: 'orders',
        eachMessage: () => Promise.resolve(),
        checkpoints: {
          read: () => Promise.resolve({ lastCheckpoint: checkpoint }),
          store: () => Promise.resolve({ success: true, newCheckpoint: null }),
        },
        observability: config,
      }),
    )
      .when((reactor) => reactor.start({}))
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.readCheckpoint)
          .hasParentSpanNamed(S.start)
          .hasAttributes({ [A.processor.checkpoint]: checkpoint })
          .noLogs(),
      );
  });

  it('reading an empty checkpoint leaves the read_checkpoint span without a checkpoint', async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        eachMessage: () => Promise.resolve(),
        checkpoints: {
          read: () => Promise.resolve({ lastCheckpoint: null }),
          store: () => Promise.resolve({ success: true, newCheckpoint: null }),
        },
        observability: config,
      }),
    )
      .when((reactor) => reactor.start({}))
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.readCheckpoint)
          .hasParentSpanNamed(S.start)
          .hasAttributes({ [A.processor.checkpoint]: undefined }),
      );
  });

  it('no acquire_lock, hooks.on_start or read_checkpoint span is created when the processor has none of them', async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when(async (reactor, config) => {
        await reactor.start({});
        return config.tracer.spans.map((s) => s.name);
      })
      .then(({ result }) => assertDeepEqual(result, [S.start]));
  });

  it('a failing onStart hook fails its span and the start span and logs nothing', async () => {
    const failure = new Error('hook failed');

    await given((config) =>
      reactor({
        processorId: 'orders',
        eachMessage: () => Promise.resolve(),
        hooks: { onStart: () => Promise.reject(failure) },
        observability: config,
      }),
    )
      .when((reactor) => reactor.start({}))
      .thenThrows(({ spans, error }) => {
        assertDeepEqual(error, failure);
        spans
          .hasSingleSpanNamed(S.onStart)
          .hasParentSpanNamed(S.start)
          .hasError(failure)
          .noLogs();
        spans
          .hasSingleSpanNamed(S.start)
          .hasError(failure)
          .logged('debug', 'Starting processor')
          .logged('debug', 'Running processor onStart hook')
          .loggedCount(2);
      });
  });
});

describe('processor close observability', () => {
  const S = EmmettSpans.processor;
  const processorIds = {
    [A.processor.id]: 'orders',
    [A.processor.instanceId]: 'orders-1',
    [A.processor.type]: 'reactor',
  };

  it('every close opens an emmett.processor.close span with processor ids', async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        processorInstanceId: 'orders-1',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.close({});
      })
      .then(({ spans }) =>
        spans
          .haveSpansNamed(S.close)
          .hasCount(2)
          .haveAttributes({ ...processorIds, [A.scope.main]: true }),
      );
  });

  it('a clean close logs Processor stopped once inside the close span', async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        processorInstanceId: 'orders-1',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when(async (reactor, config) => {
        await reactor.start({});
        await reactor.close({});
        return config.tracer.spans.filter((s) => s.name === S.close);
      })
      .then(({ result: closeSpans }) => {
        assertDeepEqual(closeSpans.length, 1);
        assertThatSpan(closeSpans[0])
          .logged('info', 'Processor stopped', processorIds)
          .loggedCount(1);
      });
  });

  it('the lock is released in a release_lock span under the close span, before onClose runs', async () => {
    const steps: string[] = [];

    await given((config) =>
      reactor({
        processorId: 'orders',
        eachMessage: () => Promise.resolve(),
        lock: {
          lock: {
            tryAcquire: () => Promise.resolve(true),
            release: (context) => {
              steps.push('release');
              context.observabilityScope.log(LogEvent.debug('lock released'));
              return Promise.resolve();
            },
          },
        },
        hooks: {
          onClose: () => {
            steps.push('onClose');
            return Promise.resolve();
          },
        },
        observability: config,
      }),
    )
      .when(async (reactor, config) => {
        await reactor.start({});
        await reactor.close({});
        return {
          steps: [...steps],
          spans: config.tracer.spans.filter(
            (s) => s.name === S.close || s.name === S.releaseLock,
          ),
        };
      })
      .then(({ result }) => {
        assertDeepEqual(result.steps, ['release', 'onClose']);
        assertThatSpans(result.spans)
          .hasSingleSpanNamed(S.releaseLock)
          .hasParentSpanNamed(S.close)
          .logged('debug', 'lock released')
          .loggedCount(1);
      });
  });

  it('closing a processor that never acquired a lock creates no release_lock span', async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        eachMessage: () => Promise.resolve(),
        hooks: { onClose: () => Promise.resolve() },
        observability: config,
      }),
    )
      .when(async (reactor, config) => {
        await reactor.start({});
        await reactor.close({});
        return config.tracer.spans.map((s) => s.name);
      })
      .then(({ result }) => assertDeepEqual(result, [S.start, S.close]));
  });

  it("the close span is a child of the caller's scope when one is given", async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        eachMessage: () => Promise.resolve(),
        observability: config,
      }),
    )
      .when(async (reactor, config) => {
        await reactor.start({});
        await ObservabilityScope(config).startScope('caller', (scope) =>
          reactor.close({ observabilityScope: scope }),
        );
        return config.tracer.spans.filter(
          (s) => s.name === S.close || s.name === 'caller',
        );
      })
      .then(({ result }) =>
        assertThatSpans(result)
          .hasSingleSpanNamed(S.close)
          .hasParentSpanNamed('caller')
          .logged('info', 'Processor stopped'),
      );
  });
});

describe('processor failure observability', () => {
  const processorIds = {
    [A.processor.id]: 'orders',
    [A.processor.instanceId]: 'orders-1',
    [A.processor.type]: 'reactor',
  };
  const checkpointBefore = ProcessorCheckpoint('2');
  const failingMessage = makeMessage('OrderPlaced', {
    messageId: 'message-1',
    streamName: 'order-1',
    streamPosition: 3n,
    checkpoint: ProcessorCheckpoint('3'),
  });

  it('a failing message handler logs one error with message and processor attributes and stops the processor', async () => {
    const failure = new EmmettError('boom');

    await given((config) =>
      reactor({
        processorId: 'orders',
        processorInstanceId: 'orders-1',
        startFrom: { lastCheckpoint: checkpointBefore },
        eachMessage: () => Promise.reject(failure),
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({});
        const result = await reactor.handle([failingMessage], {});
        return { result, isActive: reactor.isActive };
      })
      .then(({ result, spans }) => {
        assertDeepEqual(result, {
          result: {
            type: 'STOP',
            reason: 'Error during message processing',
            error: failure,
            lastSuccessfulMessage: undefined,
          },
          isActive: false,
        });
        spans
          .hasSingleSpanNamed('processor.message.OrderPlaced')
          .logged('error', 'Processor stopped: message handling failed', {
            ...processorIds,
            [A.event.type]: 'OrderPlaced',
            'messaging.message.id': 'message-1',
            [A.stream.name]: 'order-1',
            [A.stream.position]: 3,
            [A.processor.checkpointBefore]: checkpointBefore,
          })
          .loggedCount(1);
      });
  });

  it('the message failure log is named emmett.processor.message.exception and carries the error', async () => {
    const failure = new EmmettError('boom');

    await given((config) =>
      reactor({
        processorId: 'orders',
        eachMessage: () => Promise.reject(failure),
        observability: config,
      }),
    )
      .when(async (reactor, config) => {
        await reactor.start({});
        await reactor.handle([failingMessage], {});
        return config.tracer.spans.flatMap((s) =>
          s.logs.filter((l) => l.metadata.level === 'error'),
        );
      })
      .then(({ result: errorLogs }) => {
        assertDeepEqual(errorLogs.length, 1);
        assertDeepEqual(
          errorLogs[0]!.name,
          'emmett.processor.message.exception',
        );
        assertDeepEqual(errorLogs[0]!.data.error, failure);
      });
  });

  it('the message span of a failing handler has error status', async () => {
    const failure = new EmmettError('boom');

    await given((config) =>
      reactor({
        processorId: 'orders',
        eachMessage: () => Promise.reject(failure),
        observability: config,
      }),
    )
      .when(async (reactor) => {
        await reactor.start({});
        await reactor.handle([failingMessage], {});
      })
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('processor.message.OrderPlaced')
          .hasError(failure),
      );
  });

  it('a failing checkpoint store logs one error and stops the processor', async () => {
    const failure = new EmmettError('store failed');

    await given((config) =>
      reactor({
        processorId: 'orders',
        processorInstanceId: 'orders-1',
        eachMessage: () => Promise.resolve(),
        checkpoints: {
          read: () => Promise.resolve({ lastCheckpoint: null }),
          store: () => Promise.reject(failure),
        },
        observability: config,
      }),
    )
      .when(async (reactor, config) => {
        await reactor.start({});
        const result = await reactor.handle([failingMessage], {});
        return {
          result,
          isActive: reactor.isActive,
          errorLogs: config.tracer.spans.flatMap((s) =>
            s.logs.filter((l) => l.metadata.level === 'error'),
          ),
        };
      })
      .then(({ result: { result, isActive, errorLogs }, spans }) => {
        assertDeepEqual(result, {
          type: 'STOP',
          reason: 'Error during message processing',
          error: failure,
        });
        assertDeepEqual(isActive, false);
        assertDeepEqual(errorLogs.length, 1);
        assertDeepEqual(errorLogs[0]!.data.error, failure);
        spans
          .hasSingleSpanNamed('processor.handle')
          .logged(
            'error',
            'Processor stopped: processing failed',
            processorIds,
          );
      });
  });

  it('exactly one error log is written per failure', async () => {
    await given((config) =>
      reactor({
        processorId: 'orders',
        eachMessage: () => Promise.reject(new Error('boom')),
        observability: config,
      }),
    )
      .when(async (reactor, config) => {
        await reactor.start({});
        await reactor.handle([failingMessage], {});
        return config.tracer.spans.flatMap((s) =>
          s.logs.filter((l) => l.metadata.level === 'error'),
        ).length;
      })
      .then(({ result }) => assertDeepEqual(result, 1));
  });
});
