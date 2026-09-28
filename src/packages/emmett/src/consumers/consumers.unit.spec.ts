import {
  assertThatSpans,
  collectingMeter,
  collectingTracer,
  ObservabilitySpec,
} from '@event-driven-io/almanac';
import { describe, expectTypeOf, it, vi } from 'vitest';
import { MessageSourceCaughtUp } from '../eventStore/events';
import { EmmettError } from '../errors';
import {
  ProcessorCheckpoint,
  type AnyMessageProcessor,
  type CompatibleProcessor,
  type CurrentMessageProcessorPosition,
  type MessageProcessor,
} from '../processors';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertRejects,
  assertTrue,
} from '../testing';
import {
  EmmettAttributes,
  EmmettSpans,
  type EmmettObservabilityConfig,
} from '../observability';
import { reactor } from '../processors';
import type {
  AnyEvent,
  AnyMessage,
  AnyReadEventMetadata,
  Command,
  Event,
  Message,
  AnyMessageHandlerContext,
  MessageHandlerContext,
  RecordedMessage,
} from '../typing';
import { consumer, type MessageConsumerSetup } from './consumers';
import type {
  MessageSource,
  MessageSourceMessage,
} from './messageSources/messageSource';

const messageAt = (checkpoint: string): RecordedMessage =>
  ({
    type: 'Tested',
    data: {},
    metadata: { checkpoint: ProcessorCheckpoint(checkpoint) },
  }) as unknown as RecordedMessage;

const caughtUpAt = (checkpoint: string): MessageSourceMessage =>
  MessageSourceCaughtUp(ProcessorCheckpoint(checkpoint));

type TestSourceState = {
  readOptions: { from: CurrentMessageProcessorPosition } | undefined;
  teardowns: number;
  closed: number;
};

const testSource = (
  messages: MessageSourceMessage[],
  options?: {
    lastCheckpoint?: string;
  },
): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source: MessageSource<any, any>;
  state: TestSourceState;
} => {
  const state: TestSourceState = {
    readOptions: undefined,
    teardowns: 0,
    closed: 0,
  };

  const lastCheckpoint =
    options?.lastCheckpoint !== undefined
      ? ProcessorCheckpoint(options.lastCheckpoint)
      : null;

  return {
    state,
    source: {
      read: async function* (readOptions) {
        state.readOptions = readOptions;
        try {
          for (const message of messages) {
            if (readOptions.signal.aborted) return;
            yield message;
          }

          await new Promise<void>((resolve) => {
            if (readOptions.signal.aborted) {
              resolve();
              return;
            }
            readOptions.signal.addEventListener('abort', () => resolve(), {
              once: true,
            });
          });
        } finally {
          state.teardowns++;
        }
      },
      readLastMessageCheckpoint: () => Promise.resolve(lastCheckpoint),
      close: () => {
        state.closed++;
        return Promise.resolve();
      },
    },
  };
};

type TestProcessorState = {
  handled: RecordedMessage[][];
  inits: number;
  closes: number;
  starts: number;
  contexts: unknown[];
};

const testProcessor = (
  id: string,
  options?: {
    startFrom?: CurrentMessageProcessorPosition;
    onHandle?: (
      messages: RecordedMessage[],
    ) => { type: 'STOP'; reason?: string } | undefined;
  },
): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processor: MessageProcessor<any, any, any>;
  state: TestProcessorState;
} => {
  const state: TestProcessorState = {
    handled: [],
    inits: 0,
    closes: 0,
    starts: 0,
    contexts: [],
  };
  let isActive = true;

  return {
    state,
    processor: {
      id,
      instanceId: id,
      type: 'reactor',
      init: (context: unknown) => {
        state.inits++;
        state.contexts.push(context);
        return Promise.resolve();
      },
      start: (context: unknown) => {
        state.starts++;
        state.contexts.push(context);
        return Promise.resolve(options?.startFrom);
      },
      close: (context: unknown) => {
        state.closes++;
        state.contexts.push(context);
        return Promise.resolve();
      },
      get isActive() {
        return isActive;
      },
      whenProcessed: () => Promise.resolve(),
      handle: (messages: RecordedMessage[], context: unknown) => {
        state.handled.push(messages);
        state.contexts.push(context);
        const result = options?.onHandle?.(messages);
        if (result?.type === 'STOP') isActive = false;
        return result;
      },
    },
  };
};

type TestProcessorFactory = (options: {
  processor: AnyMessageProcessor;
}) => AnyMessageProcessor;

const testProcessorFactory: TestProcessorFactory = ({ processor }) => processor;

const testConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends AnyMessageHandlerContext = AnyMessageHandlerContext,
>(
  options: Omit<
    MessageConsumerSetup<
      ConsumerMessageType,
      MessageMetadataType,
      HandlerContext,
      TestProcessorFactory,
      TestProcessorFactory,
      TestProcessorFactory
    >,
    'reactorFactory' | 'projectorFactory' | 'workflowProcessorFactory'
  >,
) =>
  consumer<
    ConsumerMessageType,
    MessageMetadataType,
    HandlerContext,
    TestProcessorFactory,
    TestProcessorFactory,
    TestProcessorFactory
  >({
    ...options,
    reactorFactory: testProcessorFactory,
    projectorFactory: testProcessorFactory,
    workflowProcessorFactory: testProcessorFactory,
  });

void describe('consumer', () => {
  void it('registers and returns a processor through reactor', () => {
    const { source } = testSource([]);
    const { processor } = testProcessor('a');
    const messageConsumer = testConsumer({ source });

    const registered = messageConsumer.reactor(processor);

    assertEqual(registered, processor);
    assertEqual(messageConsumer.processors[0], processor);
  });

  void it('does not register the same processor instance twice', () => {
    const { source } = testSource([]);
    const { processor } = testProcessor('a');
    const messageConsumer = testConsumer({ source });

    messageConsumer.reactor(processor);
    messageConsumer.reactor(processor);

    assertEqual(messageConsumer.processors.length, 1);
  });

  void it('creates, registers and returns a processor through the reactor factory', () => {
    const { source } = testSource([]);
    const { processor } = testProcessor('a');
    const messageConsumer = testConsumer({ source });

    const registered = messageConsumer.reactor({ processor });

    assertEqual(registered, processor);
    assertEqual(messageConsumer.processors[0], processor);
  });

  void it('creates, registers and returns a processor through the projector factory', () => {
    const { source } = testSource([]);
    const { processor } = testProcessor('a');
    const messageConsumer = testConsumer({ source });

    const registered = messageConsumer.projector({ processor });

    assertEqual(registered, processor);
    assertEqual(messageConsumer.processors[0], processor);
  });

  void it('only accepts event processors through projector registration', () => {
    type TestedEvent = Event<'EventTested', Record<string, never>>;
    type TestedCommand = Command<'CommandTested', Record<string, never>>;
    type TestedMessage = TestedEvent | TestedCommand;

    const { source } = testSource([]);
    const messageConsumer = testConsumer<TestedMessage>({ source });
    const eventProcessor = testProcessor('event')
      .processor as AnyMessageProcessor<TestedEvent>;

    const registered = messageConsumer.projector(eventProcessor);

    expectTypeOf(registered).toEqualTypeOf<AnyMessageProcessor<TestedEvent>>();
    expectTypeOf<
      CompatibleProcessor<
        TestedMessage & AnyEvent,
        AnyMessageProcessor<TestedCommand>
      >
    >().toBeNever();
  });

  void it('creates, registers and returns a processor through the workflow factory', () => {
    const { source } = testSource([]);
    const { processor } = testProcessor('a');
    const messageConsumer = testConsumer({ source });

    const registered = messageConsumer.workflowProcessor({ processor });

    assertEqual(registered, processor);
    assertEqual(messageConsumer.processors[0], processor);
  });

  void it('merges consumer observability into all processor factory options', () => {
    const { source } = testSource([]);
    const { processor } = testProcessor('a');
    const consumerTracer = collectingTracer();
    const processorTracer = collectingTracer();
    const meter = collectingMeter();
    const receivedOptions: {
      processor: AnyMessageProcessor;
      observability?: EmmettObservabilityConfig;
    }[] = [];

    const processorFactory = (factoryOptions: {
      processor: AnyMessageProcessor;
      observability?: EmmettObservabilityConfig;
    }) => {
      receivedOptions.push(factoryOptions);
      return factoryOptions.processor;
    };

    const messageConsumer = consumer({
      source,
      observability: { tracer: consumerTracer, meter },
      reactorFactory: processorFactory,
      projectorFactory: processorFactory,
      workflowProcessorFactory: processorFactory,
    });

    const processorOptions = {
      processor,
      observability: { tracer: processorTracer },
    };

    messageConsumer.reactor(processorOptions);
    messageConsumer.projector(processorOptions);
    messageConsumer.workflowProcessor(processorOptions);

    assertEqual(receivedOptions.length, 3);
    for (const factoryOptions of receivedOptions) {
      assertEqual(factoryOptions.observability?.tracer, processorTracer);
      assertEqual(factoryOptions.observability?.meter, meter);
    }
  });

  void it('strips caught up control messages before processor fan out', async () => {
    const { source } = testSource([
      messageAt('1'),
      caughtUpAt('1'),
      messageAt('2'),
      caughtUpAt('2'),
    ]);
    const { processor, state } = testProcessor('a');

    const messageConsumer = testConsumer({
      source,
      processors: [processor],
      until: { noMessagesLeft: true },
    });

    await messageConsumer.start();
    await messageConsumer.stop();

    const handled = state.handled.flat();

    assertDeepEqual(
      handled.map((m) => m.type),
      ['Tested', 'Tested'],
    );
  });

  void it('stops on the first caught up signal when until.noMessagesLeft is set', async () => {
    const { source, state: sourceState } = testSource([
      messageAt('1'),
      caughtUpAt('1'),
      messageAt('2'),
    ]);
    const { processor, state } = testProcessor('a');

    const messageConsumer = testConsumer({
      source,
      processors: [processor],
      until: { noMessagesLeft: true },
    });

    await messageConsumer.start();

    assertDeepEqual(
      state.handled.flat().map((m) => m.metadata.checkpoint),
      [ProcessorCheckpoint('1'), ProcessorCheckpoint('2')],
    );
    assertEqual(sourceState.teardowns, 1);
    assertFalse(messageConsumer.isRunning);
  });

  void it('stops once the source has nothing left when until.caughtUp is set', async () => {
    const { source, state: sourceState } = testSource([
      messageAt('1'),
      messageAt('2'),
      messageAt('3'),
      caughtUpAt('3'),
    ]);
    const { processor, state } = testProcessor('a');

    const messageConsumer = testConsumer({
      source,
      processors: [processor],
      until: { caughtUp: true },
    });

    await messageConsumer.start();

    assertDeepEqual(
      state.handled.flat().map((m) => m.metadata.checkpoint),
      [
        ProcessorCheckpoint('1'),
        ProcessorCheckpoint('2'),
        ProcessorCheckpoint('3'),
      ],
    );
    assertEqual(sourceState.teardowns, 1);
    assertFalse(messageConsumer.isRunning);
  });

  void it('tears the source down when stopped mid read', async () => {
    const { source, state: sourceState } = testSource([messageAt('1')]);
    const { processor } = testProcessor('a');

    const messageConsumer = testConsumer({ source, processors: [processor] });

    void messageConsumer.start();
    await messageConsumer.whenStarted();

    assertTrue(messageConsumer.isRunning);

    await messageConsumer.stop();

    assertEqual(sourceState.teardowns, 1);
    assertFalse(messageConsumer.isRunning);
  });

  void it('hands over a message that arrived alone once the batch deadline passes', async () => {
    vi.useFakeTimers();

    try {
      const { source } = testSource([messageAt('1')]);
      const { processor, state } = testProcessor('a');

      const messageConsumer = testConsumer({
        source,
        processors: [processor],
        batchSize: 100,
        batchDeadlineInMs: 50,
      });

      void messageConsumer.start();
      await messageConsumer.whenStarted();

      await vi.advanceTimersByTimeAsync(49);

      assertDeepEqual(state.handled, []);

      await vi.advanceTimersByTimeAsync(1);

      assertDeepEqual(
        state.handled.flat().map((m) => m.metadata.checkpoint),
        [ProcessorCheckpoint('1')],
      );

      await messageConsumer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  void it('reports started as soon as messages appended from now on will be picked up', async () => {
    let releaseSource!: () => void;
    const sourceReleased = new Promise<void>((resolve) => {
      releaseSource = resolve;
    });
    const { processor, state } = testProcessor('a');
    const source: MessageSource = {
      read: async function* () {
        await sourceReleased;
        yield caughtUpAt('0');
      },
      readLastMessageCheckpoint: () => null,
      close: () => {},
    };
    const messageConsumer = testConsumer({
      source,
      processors: [processor],
      until: { noMessagesLeft: true },
    });

    const start = messageConsumer.start();

    await messageConsumer.whenStarted();

    assertEqual(state.starts, 1);
    assertDeepEqual(state.handled, []);
    assertTrue(messageConsumer.isRunning);

    releaseSource();
    await start;
  });

  void it('stops reading once every processor went inactive', async () => {
    const { source, state: sourceState } = testSource([
      messageAt('1'),
      messageAt('2'),
      messageAt('3'),
    ]);
    const { processor, state } = testProcessor('a', {
      onHandle: () => ({ type: 'STOP', reason: 'done' }),
    });

    const messageConsumer = testConsumer({ source, processors: [processor] });

    await messageConsumer.start();

    assertEqual(state.handled.length, 1);
    assertEqual(sourceState.teardowns, 1);
  });

  void it('rejects the start when there is no processor registered', async () => {
    const { source } = testSource([]);

    const messageConsumer = testConsumer({ source });

    await assertRejects(messageConsumer.start());
  });

  void it('resolves start positions again on restart', async () => {
    const { source, state: sourceState } = testSource([
      messageAt('1'),
      caughtUpAt('1'),
    ]);
    const { processor, state } = testProcessor('a');

    const messageConsumer = testConsumer({
      source,
      processors: [processor],
      until: { noMessagesLeft: true },
    });

    await messageConsumer.start();
    await messageConsumer.stop();
    await messageConsumer.start();

    assertEqual(state.starts, 2);
    assertEqual(sourceState.teardowns, 2);
  });

  void it('wraps init, start position resolution, fan out and close in the scope', async () => {
    const { source } = testSource([messageAt('1'), caughtUpAt('1')]);
    const { processor, state } = testProcessor('a');

    let scopeCalls = 0;
    const scopeContext = {
      marker: 'scoped',
    } as unknown as MessageHandlerContext<{ marker: string }>;

    const messageConsumer = testConsumer<
      AnyMessage,
      AnyReadEventMetadata,
      typeof scopeContext
    >({
      source,
      processors: [processor],
      until: { noMessagesLeft: true },
      scope: (handler) => {
        scopeCalls++;
        return handler(scopeContext);
      },
    });

    await messageConsumer.start();

    assertTrue(scopeCalls >= 4);
    assertTrue(
      state.contexts.every(
        (context) => (context as { marker?: string }).marker === 'scoped',
      ),
    );
  });

  void it('never reads the last checkpoint from inside the scope', async () => {
    const { source } = testSource([caughtUpAt('1')], {
      lastCheckpoint: '1',
    });
    const { processor } = testProcessor('a', { startFrom: 'END' });

    let isInScope = false;
    let readFromInsideScope = false;

    const readLastMessageCheckpoint =
      source.readLastMessageCheckpoint.bind(source);
    source.readLastMessageCheckpoint = () => {
      if (isInScope) readFromInsideScope = true;
      return readLastMessageCheckpoint();
    };

    const messageConsumer = testConsumer<
      AnyMessage,
      AnyReadEventMetadata,
      MessageHandlerContext
    >({
      source,
      processors: [processor],
      until: { noMessagesLeft: true },
      scope: async (handler) => {
        isInScope = true;
        try {
          return await handler({});
        } finally {
          isInScope = false;
        }
      },
    });

    await messageConsumer.start();

    assertFalse(readFromInsideScope);
  });

  void it('does not read the last checkpoint when no processor starts from END', async () => {
    const { source } = testSource([caughtUpAt('1')], {
      lastCheckpoint: '1',
    });
    const { processor } = testProcessor('a', { startFrom: 'BEGINNING' });

    let lastCheckpointReads = 0;

    const readLastMessageCheckpoint =
      source.readLastMessageCheckpoint.bind(source);
    source.readLastMessageCheckpoint = () => {
      lastCheckpointReads++;
      return readLastMessageCheckpoint();
    };

    const messageConsumer = testConsumer({
      source,
      processors: [processor],
      until: { noMessagesLeft: true },
    });

    await messageConsumer.start();

    assertEqual(lastCheckpointReads, 0);
  });

  void it('closes a processor that failed to initialise exactly once', async () => {
    const { source } = testSource([]);
    const { processor, state } = testProcessor('a');

    const failure = new Error('Init failed');
    processor.init = () => Promise.reject(failure);

    const messageConsumer = testConsumer({
      source,
      processors: [processor],
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await assertRejects(messageConsumer.start(), failure);
    } finally {
      log.mockRestore();
    }

    assertEqual(state.closes, 1);
  });

  void it('closes the source and runs the close hook', async () => {
    const { source, state: sourceState } = testSource([]);
    const { processor } = testProcessor('a');

    let closeHookCalls = 0;

    const messageConsumer = testConsumer({
      source,
      processors: [processor],
      hooks: {
        onClose: () => {
          closeHookCalls++;
          return Promise.resolve();
        },
      },
    });

    await messageConsumer.close();

    assertEqual(sourceState.closed, 1);
    assertEqual(closeHookCalls, 1);
  });
});

void describe('consumer observability', () => {
  const given = ObservabilitySpec.for();
  const A = EmmettAttributes;
  const S = EmmettSpans;

  void it('starting a consumer opens an emmett.consumer.start span with the consumer id', async () => {
    await given((config) =>
      testConsumer({
        consumerId: 'orders-consumer',
        source: testSource([messageAt('1'), caughtUpAt('1')]).source,
        processors: [testProcessor('a').processor],
        until: { noMessagesLeft: true },
        observability: config,
      }),
    )
      .when((consumer) => consumer.start())
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.consumer.start)
          .hasNoParent()
          .hasNoError()
          .hasAttributes({
            [A.consumer.id]: 'orders-consumer',
            [A.consumer.processorCount]: 1,
            [A.scope.main]: true,
          })
          .noLogs(),
      );
  });

  void it('processor start spans are children of the consumer start span', async () => {
    await given((config) =>
      testConsumer({
        source: testSource([messageAt('1'), caughtUpAt('1')]).source,
        processors: [
          reactor({
            processorId: 'orders',
            eachMessage: () => Promise.resolve(),
            observability: config,
          }),
        ],
        until: { noMessagesLeft: true },
        observability: config,
      }),
    )
      .when((consumer) => consumer.start())
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.processor.start)
          .hasParentSpanNamed(S.consumer.start),
      );
  });

  void it('stopping a consumer opens an emmett.consumer.stop span in its own trace, linked to the start span', async () => {
    await given((config) =>
      testConsumer({
        consumerId: 'orders-consumer',
        source: testSource([messageAt('1'), caughtUpAt('1')]).source,
        processors: [
          reactor({
            processorId: 'orders',
            eachMessage: () => Promise.resolve(),
            observability: config,
          }),
        ],
        until: { noMessagesLeft: true },
        observability: config,
      }),
    )
      .when(async (consumer, config) => {
        await consumer.start();
        return config.tracer.spans;
      })
      .then(({ result: collected, spans }) => {
        const start = collected.find((s) => s.name === S.consumer.start)!;

        spans
          .hasSingleSpanNamed(S.consumer.stop)
          .hasNoParent()
          .hasNoError()
          .hasCreationLinks([start.ownContext])
          .hasAttributes({
            [A.consumer.id]: 'orders-consumer',
            [A.consumer.processorCount]: 1,
            [A.scope.main]: true,
          })
          .noLogs();
        assertThatSpans(collected)
          .hasSingleSpanNamed(S.processor.close)
          .hasParentSpanNamed(S.consumer.stop);
      });
  });

  void it('a consumer that fails logs one Consumer stopped error with the consumer and processor ids', async () => {
    const failure = new EmmettError('handling failed');
    const { processor } = testProcessor('a');
    processor.handle = () => Promise.reject(failure);

    await given((config) =>
      testConsumer({
        consumerId: 'orders-consumer',
        source: testSource([messageAt('1'), caughtUpAt('1')]).source,
        processors: [processor],
        until: { noMessagesLeft: true },
        observability: config,
      }),
    )
      .when(async (consumer, config) => {
        const error = await consumer.start().catch((error: unknown) => error);
        return {
          error,
          errorLogs: config.tracer.spans.flatMap((s) =>
            s.logs.filter((l) => l.metadata.level === 'error'),
          ),
        };
      })
      .then(({ result: { error, errorLogs }, spans }) => {
        assertDeepEqual(error, failure);
        assertEqual(errorLogs.length, 1);
        assertEqual(errorLogs[0]!.name, 'emmett.consumer.exception');
        assertDeepEqual(errorLogs[0]!.data.error, failure);
        spans
          .hasSingleSpanNamed(S.consumer.stop)
          .logged('error', 'Consumer stopped', {
            [A.consumer.id]: 'orders-consumer',
            [A.processor.id]: 'a',
          })
          .loggedCount(1);
      });
  });

  void it('a failing processor init logs nothing but Consumer stopped', async () => {
    const failure = new EmmettError('init failed');
    const { processor } = testProcessor('a');
    processor.init = () => Promise.reject(failure);
    const stdout = vi.spyOn(console, 'log');
    let stdoutCalls: number | undefined;

    try {
      await given((config) =>
        testConsumer({
          consumerId: 'orders-consumer',
          source: testSource([]).source,
          processors: [processor],
          observability: config,
        }),
      )
        .when(async (consumer, config) => {
          const error = await consumer.start().catch((error: unknown) => error);
          return {
            error,
            logs: config.tracer.spans.flatMap((s) => s.logs),
          };
        })
        .then(({ result: { error, logs }, spans }) => {
          assertDeepEqual(error, failure);
          assertEqual(logs.length, 1);
          spans.hasSingleSpanNamed(S.consumer.start).hasError(failure).noLogs();
          spans
            .hasSingleSpanNamed(S.consumer.stop)
            .logged('error', 'Consumer stopped', {
              [A.consumer.id]: 'orders-consumer',
              [A.processor.id]: 'a',
            });
        });
      stdoutCalls = stdout.mock.calls.length;
    } finally {
      stdout.mockRestore();
    }

    assertEqual(stdoutCalls, 0);
  });

  void it('a failing cleanup after init failure logs a warning with the processor id', async () => {
    const initFailure = new EmmettError('init failed');
    const closeFailure = new EmmettError('close failed');
    const { processor } = testProcessor('a');
    processor.init = () => Promise.reject(initFailure);
    processor.close = () => Promise.reject(closeFailure);

    await given((config) =>
      testConsumer({
        source: testSource([]).source,
        processors: [processor],
        observability: config,
      }),
    )
      .when((consumer) => consumer.start().catch(() => {}))
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed(S.consumer.start)
          .logged('warn', 'Processor cleanup after failed init failed', {
            [A.processor.id]: 'a',
          })
          .loggedCount(1),
      );
  });

  void it('starting an already running consumer logs at debug', async () => {
    await given((config) =>
      testConsumer({
        consumerId: 'orders-consumer',
        source: testSource([]).source,
        processors: [testProcessor('a').processor],
        observability: config,
      }),
    )
      .when(async (consumer, config) => {
        const first = consumer.start();
        await consumer.whenStarted();
        const second = consumer.start();
        await consumer.stop();
        await first;
        return {
          sameStart: first === second,
          startSpans: config.tracer.spans.filter(
            (s) => s.name === S.consumer.start,
          ),
        };
      })
      .then(({ result: { sameStart, startSpans } }) => {
        assertTrue(sameStart);
        assertEqual(startSpans.length, 2);
        assertThatSpans(startSpans)
          .haveSpansNamed(S.consumer.start)
          .hasCount(2);
        assertDeepEqual(
          startSpans[1]!.logs.map((l) => [
            l.metadata.level,
            l.data.body,
            l.data.attributes,
          ]),
          [
            [
              'debug',
              'Consumer already running',
              { [A.consumer.id]: 'orders-consumer' },
            ],
          ],
        );
      });
  });
});
