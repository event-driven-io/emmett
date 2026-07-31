import { describe, it, vi } from 'vitest';
import { MessageSourceCaughtUp } from '../eventStore/events';
import {
  ProcessorCheckpoint,
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
import type {
  AnyMessage,
  AnyReadEventMetadata,
  MessageHandlerContext,
  RecordedMessage,
} from '../typing';
import { consumer } from './consumers';
import type { MessageSource, MessageSourceMessage } from './messageSource';

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
    compareCheckpoints?: (
      a: ProcessorCheckpoint,
      b: ProcessorCheckpoint,
    ) => number;
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
      compareCheckpoints: options?.compareCheckpoints,
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
      // eslint-disable-next-line @typescript-eslint/require-await
      handle: async (messages: RecordedMessage[], context: unknown) => {
        state.handled.push(messages);
        state.contexts.push(context);
        const result = options?.onHandle?.(messages);
        if (result?.type === 'STOP') isActive = false;
        return result;
      },
    },
  };
};

void describe('consumer', () => {
  void it('strips caught up control messages before processor fan out', async () => {
    const { source } = testSource([
      messageAt('1'),
      caughtUpAt('1'),
      messageAt('2'),
      caughtUpAt('2'),
    ]);
    const { processor, state } = testProcessor('a');

    const messageConsumer = consumer({
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

    const messageConsumer = consumer({
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

    const messageConsumer = consumer({
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

    const messageConsumer = consumer({ source, processors: [processor] });

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

      const messageConsumer = consumer({
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
      readLastMessageCheckpoint: () => Promise.resolve(null),
    };
    const messageConsumer = consumer({
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

    const messageConsumer = consumer({ source, processors: [processor] });

    await messageConsumer.start();

    assertEqual(state.handled.length, 1);
    assertEqual(sourceState.teardowns, 1);
  });

  void it('rejects the start when there is no processor registered', async () => {
    const { source } = testSource([]);

    const messageConsumer = consumer({ source });

    await assertRejects(messageConsumer.start());
  });

  void it('resolves start positions again on restart', async () => {
    const { source, state: sourceState } = testSource([
      messageAt('1'),
      caughtUpAt('1'),
    ]);
    const { processor, state } = testProcessor('a');

    const messageConsumer = consumer({
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

  void it('uses the source comparator when zipping start positions', async () => {
    const numericCompare = (a: ProcessorCheckpoint, b: ProcessorCheckpoint) => {
      const [left, right] = [BigInt(a), BigInt(b)];
      return left > right ? 1 : left < right ? -1 : 0;
    };

    const { source, state: sourceState } = testSource([caughtUpAt('20')], {
      compareCheckpoints: numericCompare,
    });

    const { processor: first } = testProcessor('a', {
      startFrom: { lastCheckpoint: ProcessorCheckpoint('10') },
    });
    const { processor: second } = testProcessor('b', {
      startFrom: { lastCheckpoint: ProcessorCheckpoint('9') },
    });

    const messageConsumer = consumer({
      source,
      processors: [first, second],
      until: { noMessagesLeft: true },
    });

    await messageConsumer.start();

    assertDeepEqual(sourceState.readOptions?.from, {
      lastCheckpoint: ProcessorCheckpoint('9'),
    });
  });

  void it('wraps init, start position resolution, fan out and close in the scope', async () => {
    const { source } = testSource([messageAt('1'), caughtUpAt('1')]);
    const { processor, state } = testProcessor('a');

    let scopeCalls = 0;
    const scopeContext = {
      marker: 'scoped',
    } as unknown as MessageHandlerContext<{ marker: string }>;

    const messageConsumer = consumer<
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

    const messageConsumer = consumer<
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

    const messageConsumer = consumer({
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

    const messageConsumer = consumer({
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

    const messageConsumer = consumer({
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
