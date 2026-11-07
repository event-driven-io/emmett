import { assertDeepEqual, assertEqual } from '@event-driven-io/emmett';
import { describe, it } from 'node:test';
import { zipPostgreSQLEventStoreMessageBatchPullerStartFrom } from './index';

void describe('zipPostgreSQLEventStoreMessageBatchPullerStartFrom', () => {
  const at = (lastCheckpoint: bigint) => ({ lastCheckpoint });

  void it('returns the earliest checkpoint wherever it is in the list', () => {
    assertDeepEqual(
      zipPostgreSQLEventStoreMessageBatchPullerStartFrom([
        at(315n),
        at(0n),
        at(331n),
        at(9n),
      ]),
      at(0n),
    );
    assertDeepEqual(
      zipPostgreSQLEventStoreMessageBatchPullerStartFrom([
        at(5n),
        at(2n),
        at(9n),
      ]),
      at(2n),
    );
  });

  void it('ignores END processors when picking the earliest checkpoint', () => {
    assertDeepEqual(
      zipPostgreSQLEventStoreMessageBatchPullerStartFrom([
        at(7n),
        'END',
        at(3n),
      ]),
      at(3n),
    );
  });

  void it('returns BEGINNING when any processor has no checkpoint', () => {
    assertEqual(
      zipPostgreSQLEventStoreMessageBatchPullerStartFrom([undefined, at(9n)]),
      'BEGINNING',
    );
  });

  void it('returns END when every processor starts from END', () => {
    assertEqual(
      zipPostgreSQLEventStoreMessageBatchPullerStartFrom(['END', 'END']),
      'END',
    );
  });
});
