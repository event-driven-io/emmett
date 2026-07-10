import { describe, it } from 'vitest';
import { assertDeepEqual } from '../testing';
import type { RecordedMessage } from '../typing';
import { bigIntProcessorCheckpoint } from './checkpoints';
import { processorStartPositions } from './processorStartPositions';

const messageAt = (checkpoint: bigint): RecordedMessage =>
  ({
    metadata: { checkpoint: bigIntProcessorCheckpoint(checkpoint) },
  }) as unknown as RecordedMessage;

void describe('processorStartPositions', () => {
  void describe('zip', () => {
    void it('folds to the earliest checkpoint across processors', () => {
      const startPositions = processorStartPositions();
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
      const startPositions = processorStartPositions();

      startPositions.set('a', 'END');
      startPositions.set('b', 'END');

      assertDeepEqual(startPositions.zip(), 'END');
    });

    void it('folds to BEGINNING when any processor starts from BEGINNING', () => {
      const startPositions = processorStartPositions();

      startPositions.set('a', 'BEGINNING');
      startPositions.set('b', {
        lastCheckpoint: bigIntProcessorCheckpoint(9n),
      });

      assertDeepEqual(startPositions.zip(), 'BEGINNING');
    });

    void it('folds to BEGINNING when there are no processors', () => {
      const startPositions = processorStartPositions();

      assertDeepEqual(startPositions.zip(), 'BEGINNING');
    });
  });

  void describe('afterStartPosition', () => {
    void it('drops messages at or below the processor start checkpoint', () => {
      const startPositions = processorStartPositions();
      startPositions.set('a', {
        lastCheckpoint: bigIntProcessorCheckpoint(5n),
      });

      const messages = [messageAt(4n), messageAt(5n), messageAt(6n)];

      assertDeepEqual(startPositions.afterStartPosition('a', messages), [
        messageAt(6n),
      ]);
    });

    void it('keeps every message for a BEGINNING processor', () => {
      const startPositions = processorStartPositions();
      startPositions.set('a', 'BEGINNING');

      const messages = [messageAt(1n), messageAt(2n)];

      assertDeepEqual(
        startPositions.afterStartPosition('a', messages),
        messages,
      );
    });

    void it('keeps every message for an END processor with no resolved tail', () => {
      const startPositions = processorStartPositions();
      startPositions.set('a', 'END');

      const messages = [messageAt(1n), messageAt(2n)];

      assertDeepEqual(
        startPositions.afterStartPosition('a', messages),
        messages,
      );
    });

    void it('keeps every message for an unset processor', () => {
      const startPositions = processorStartPositions();

      const messages = [messageAt(1n), messageAt(2n)];

      assertDeepEqual(
        startPositions.afterStartPosition('a', messages),
        messages,
      );
    });
  });
});
