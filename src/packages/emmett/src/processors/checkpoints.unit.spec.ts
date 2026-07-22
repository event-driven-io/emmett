import { describe, it } from 'vitest';
import { assertEqual } from '../testing';
import { ProcessorCheckpoint } from './checkpoints';

void describe('ProcessorCheckpoint.compare', () => {
  const a = ProcessorCheckpoint('1');
  const b = ProcessorCheckpoint('2');

  void it('returns a negative number when the first is lower', () => {
    assertEqual(ProcessorCheckpoint.compare(a, b) < 0, true);
  });

  void it('returns a positive number when the first is higher', () => {
    assertEqual(ProcessorCheckpoint.compare(b, a) > 0, true);
  });

  void it('returns 0 when the checkpoints are equal', () => {
    assertEqual(ProcessorCheckpoint.compare(a, ProcessorCheckpoint('1')), 0);
  });
});
