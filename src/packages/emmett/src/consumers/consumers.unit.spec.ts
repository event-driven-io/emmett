import { describe, it, vi } from 'vitest';
import { MessageSourceCaughtUp } from '../eventStore/events';
import {
  ProcessorCheckpoint,
  type AnyMessageProcessor,
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
import type { EmmettObservabilityConfig } from '../observability';
import type {
  AnyMessage,
  AnyReadEventMetadata,
  Message,
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

type TestReactorFactory = (options: {
  processor: AnyMessageProcessor;
}) => AnyMessageProcessor;

const testReactorFactory: TestReactorFactory = ({ processor }) => processor;

const testConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends MessageHandlerContext | undefined = undefined,
>(
  options: Omit<
    MessageConsumerSetup<
      ConsumerMessageType,
      MessageMetadataType,
      HandlerContext,
      TestReactorFactory
    >,
    'reactorFactory'
  >,
) =>
  consumer<
    ConsumerMessageType,
    MessageMetadataType,
    HandlerContext,
    TestReactorFactory
  >({ ...options, reactorFactory: testReactorFactory });

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

  void it('merges consumer observability into reactor factory options', () => {
    const { source } = testSource([]);
    const { processor } = testProcessor('a');
    const consumerTracer = {} as NonNullable<
      EmmettObservabilityConfig['tracer']
    >;
    const processorTracer = {} as NonNullable<
      EmmettObservabilityConfig['tracer']
    >;
    const meter = {} as NonNullable<EmmettObservabilityConfig['meter']>;
    let receivedOptions:
      | {
          processor: AnyMessageProcessor;
          observability?: EmmettObservabilityConfig;
        }
      | undefined;

    const messageConsumer = consumer({
      source,
      observability: { tracer: consumerTracer, meter },
      reactorFactory: (options: {
        processor: AnyMessageProcessor;
        observability?: EmmettObservabilityConfig;
      }) => {
        receivedOptions = options;
        return options.processor;
      },
    });

    messageConsumer.reactor({
      processor,
      observability: { tracer: processorTracer },
    });

    assertEqual(receivedOptions?.observability?.tracer, processorTracer);
    assertEqual(receivedOptions?.observability?.meter, meter);
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
    assertTrue(state.contexts.every((context) => context === scopeContext));
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
