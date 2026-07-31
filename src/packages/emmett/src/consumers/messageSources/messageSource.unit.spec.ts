import { describe, it } from 'vitest';
import type { EmmettError } from '../../errors';
import { assertEqual, assertThrows } from '../../testing';
import { toBatchSize } from './messageSource';

void describe('toBatchSize', () => {
  void it('falls back when no batch size was requested', () => {
    assertEqual(100, toBatchSize(undefined, 100));
  });

  void it('keeps the requested batch size', () => {
    assertEqual(5, toBatchSize(5, 100));
  });

  void it('rejects a batch size that would read nothing', () => {
    assertThrows<EmmettError>(
      () => toBatchSize(0, 100),
      (error) =>
        error.message ===
        'Batch size has to be an integer greater than 0, got: 0',
    );
    assertThrows<EmmettError>(() => toBatchSize(-1, 100));
  });

  void it('rejects a fractional batch size', () => {
    assertThrows<EmmettError>(() => toBatchSize(2.5, 100));
  });
});
