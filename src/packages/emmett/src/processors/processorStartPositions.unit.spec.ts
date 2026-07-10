import { describe, it } from 'vitest';
import { assertDeepEqual } from '../testing';
import type {
  AnyMessage,
  MessageHandlerContext,
  RecordedMessage,
} from '../typing';
import { bigIntProcessorCheckpoint } from './checkpoints';
import {
  ConsumerStartPositions,
  ProcessorStartPositions,
} from './processorStartPositions';
import type {
  CurrentMessageProcessorPosition,
  MessageProcessor,
} from './processors';

const messageAt = (checkpoint: bigint): RecordedMessage =>
  ({
    metadata: { checkpoint: bigIntProcessorCheckpoint(checkpoint) },
  }) as unknown as RecordedMessage;

void describe('processorStartPositions', () => {
  void describe('zip', () => {
    void it('folds to the earliest checkpoint across processors', () => {
      const startPositions = ProcessorStartPositions();
      const earliest = { lastCheckpoint: bigIntProcessorCheckpoint(2n) };

      startPositions.set('a', {
        lastCheckpoint: bigIntProcessorCheckpoint(5n),
      });
      startPositions.set('b', earliest);
      startPositions.set('c', {
        lastCheckpoint: bigIntProcessorCheckpoint(9n),
      });

      assertDeepEqual(startPositions.zip(), earliest);
    });

    void it('folds to END only when every processor starts from END', () => {
      const startPositions = ProcessorStartPositions();

      startPositions.set('a', 'END');
      startPositions.set('b', 'END');

      assertDeepEqual(startPositions.zip(), 'END');
    });

    void it('folds to BEGINNING when any processor starts from BEGINNING', () => {
      const startPositions = ProcessorStartPositions();

      startPositions.set('a', 'BEGINNING');
      startPositions.set('b', {
        lastCheckpoint: bigIntProcessorCheckpoint(9n),
      });

      assertDeepEqual(startPositions.zip(), 'BEGINNING');
    });

    void it('folds to BEGINNING when there are no processors', () => {
      const startPositions = ProcessorStartPositions();

      assertDeepEqual(startPositions.zip(), 'BEGINNING');
    });
  });

  void describe('resolveEndPositions', () => {
    const processor = (
      id: string,
      startFrom: CurrentMessageProcessorPosition,
    ) =>
      ({
        id,
        start: () => Promise.resolve(startFrom),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as MessageProcessor<AnyMessage, any, MessageHandlerContext>;

    void it('maps END to the resolved tail so zip and afterStartPosition use it', async () => {
      const tail = bigIntProcessorCheckpoint(5n);
      const startPositions = await ConsumerStartPositions.resolve<
        AnyMessage,
        MessageHandlerContext
      >({
        handlerContext: {},
        processors: [processor('a', 'END')],
        readLastMessageCheckpoint: () => Promise.resolve(tail),
      });

      assertDeepEqual(startPositions.earliestPosition, {
        lastCheckpoint: tail,
      });
      assertDeepEqual(
        startPositions.afterStartPosition('a', [
          messageAt(4n),
          messageAt(5n),
          messageAt(6n),
        ]),
        [messageAt(6n)],
      );
    });

    void it('replaces END as BEGINNING when the resolver yields null', async () => {
      const startPositions = await ConsumerStartPositions.resolve<
        AnyMessage,
        MessageHandlerContext
      >({
        handlerContext: {},
        processors: [processor('a', 'END')],
        readLastMessageCheckpoint: () => Promise.resolve(null),
      });

      assertDeepEqual(startPositions.earliestPosition, 'BEGINNING');

      const messages = [messageAt(1n), messageAt(2n)];
      assertDeepEqual(
        startPositions.afterStartPosition('a', messages),
        messages,
      );
    });

    void it('does not call the resolver when no position is END', async () => {
      let calls = 0;
      const startPositions = await ConsumerStartPositions.resolve<
        AnyMessage,
        MessageHandlerContext
      >({
        handlerContext: {},
        processors: [
          processor('a', 'BEGINNING'),
          processor('b', {
            lastCheckpoint: bigIntProcessorCheckpoint(3n),
          }),
        ],
        readLastMessageCheckpoint: () => {
          calls++;
          return Promise.resolve(bigIntProcessorCheckpoint(9n));
        },
      });

      assertDeepEqual(calls, 0);
      assertDeepEqual(startPositions.earliestPosition, 'BEGINNING');
    });

    void it('calls the resolver exactly once and maps every END entry', async () => {
      const tail = bigIntProcessorCheckpoint(7n);
      let calls = 0;

      const startPositions = await ConsumerStartPositions.resolve<
        AnyMessage,
        MessageHandlerContext
      >({
        handlerContext: {},
        processors: [processor('a', 'END'), processor('b', 'END')],
        readLastMessageCheckpoint: () => {
          calls++;
          return Promise.resolve(tail);
        },
      });

      assertDeepEqual(calls, 1);
      assertDeepEqual(startPositions.earliestPosition, {
        lastCheckpoint: tail,
      });
    });
  });

  void describe('afterStartPosition', () => {
    void it('drops messages at or below the processor start checkpoint', () => {
      const startPositions = ProcessorStartPositions();
      startPositions.set('a', {
        lastCheckpoint: bigIntProcessorCheckpoint(5n),
      });

      const messages = [messageAt(4n), messageAt(5n), messageAt(6n)];

      assertDeepEqual(startPositions.afterStartPosition('a', messages), [
        messageAt(6n),
      ]);
    });

    void it('keeps every message for a BEGINNING processor', () => {
      const startPositions = ProcessorStartPositions();
      startPositions.set('a', 'BEGINNING');

      const messages = [messageAt(1n), messageAt(2n)];

      assertDeepEqual(
        startPositions.afterStartPosition('a', messages),
        messages,
      );
    });

    void it('keeps every message for an END processor with no resolved tail', () => {
      const startPositions = ProcessorStartPositions();
      startPositions.set('a', 'END');

      const messages = [messageAt(1n), messageAt(2n)];

      assertDeepEqual(
        startPositions.afterStartPosition('a', messages),
        messages,
      );
    });

    void it('keeps every message for an unset processor', () => {
      const startPositions = ProcessorStartPositions();

      const messages = [messageAt(1n), messageAt(2n)];

      assertDeepEqual(
        startPositions.afterStartPosition('a', messages),
        messages,
      );
    });
  });
});
