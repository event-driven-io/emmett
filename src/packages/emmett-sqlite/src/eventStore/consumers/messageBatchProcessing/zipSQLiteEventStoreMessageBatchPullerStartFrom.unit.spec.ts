import {
  assertDeepEqual,
  bigIntProcessorCheckpoint,
} from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import { zipSQLiteEventStoreMessageBatchPullerStartFrom } from './index';

void describe('zipSQLiteEventStoreMessageBatchPullerStartFrom', () => {
  void it('starts from the earliest checkpoint when processors are seeded differently', () => {
    const earliest = { lastCheckpoint: bigIntProcessorCheckpoint(2n) };

    const result = zipSQLiteEventStoreMessageBatchPullerStartFrom([
      { lastCheckpoint: bigIntProcessorCheckpoint(5n) },
      earliest,
      { lastCheckpoint: bigIntProcessorCheckpoint(9n) },
    ]);

    assertDeepEqual(result, earliest);
  });

  void it('starts from END only when every processor starts from END', () => {
    const result = zipSQLiteEventStoreMessageBatchPullerStartFrom([
      'END',
      'END',
    ]);

    assertDeepEqual(result, 'END');
  });

  void it('starts from BEGINNING when any processor starts from BEGINNING', () => {
    const result = zipSQLiteEventStoreMessageBatchPullerStartFrom([
      'BEGINNING',
      { lastCheckpoint: bigIntProcessorCheckpoint(9n) },
    ]);

    assertDeepEqual(result, 'BEGINNING');
  });

  void it('starts from BEGINNING when a processor has no position', () => {
    const result = zipSQLiteEventStoreMessageBatchPullerStartFrom([
      undefined,
      { lastCheckpoint: bigIntProcessorCheckpoint(9n) },
    ]);

    assertDeepEqual(result, 'BEGINNING');
  });
});
