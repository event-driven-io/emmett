import { describe, it } from 'vitest';
import { assertDeepEqual } from '../testing';
import { bigIntProcessorCheckpoint } from './checkpoints';
import { CurrentMessageProcessorPosition } from './processors';

void describe('CurrentMessageProcessorPosition.zip', () => {
  void it('starts from the earliest checkpoint when processors are seeded differently', () => {
    const earliest = { lastCheckpoint: bigIntProcessorCheckpoint(2n) };

    const result = CurrentMessageProcessorPosition.zip([
      { lastCheckpoint: bigIntProcessorCheckpoint(5n) },
      earliest,
      { lastCheckpoint: bigIntProcessorCheckpoint(9n) },
    ]);

    assertDeepEqual(result, earliest);
  });

  void it('starts from END only when every processor starts from END', () => {
    const result = CurrentMessageProcessorPosition.zip(['END', 'END']);

    assertDeepEqual(result, 'END');
  });

  void it('starts from BEGINNING when any processor starts from BEGINNING', () => {
    const result = CurrentMessageProcessorPosition.zip([
      'BEGINNING',
      { lastCheckpoint: bigIntProcessorCheckpoint(9n) },
    ]);

    assertDeepEqual(result, 'BEGINNING');
  });

  void it('starts from BEGINNING when a processor has no position', () => {
    const result = CurrentMessageProcessorPosition.zip([
      undefined,
      { lastCheckpoint: bigIntProcessorCheckpoint(9n) },
    ]);

    assertDeepEqual(result, 'BEGINNING');
  });
});
