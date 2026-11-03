import { describe, it } from 'vitest';
import { assertEqual, assertFalse, assertTrue } from '../testing';
import { emmettTypeId, hasTypeId } from './typeId';

void describe('emmettTypeId', () => {
  void it('creates a global symbol with the Emmett prefix', () => {
    assertEqual(
      Symbol.for('@event-driven-io/emmett/EmmettError'),
      emmettTypeId('EmmettError'),
    );
  });

  void it('returns the same symbol for the same name', () => {
    assertEqual(emmettTypeId('EmmettError'), emmettTypeId('EmmettError'));
  });
});

void describe('hasTypeId', () => {
  const typeId = emmettTypeId('Sample');

  void it('matches a value that carries the type id', () => {
    assertTrue(hasTypeId({ [typeId]: true }, typeId));
  });

  void it('matches a value with the type id from the global symbol registry', () => {
    assertTrue(
      hasTypeId(
        { [Symbol.for('@event-driven-io/emmett/Sample')]: true },
        typeId,
      ),
    );
  });

  void it('does not match a value with a different type id', () => {
    assertFalse(hasTypeId({ [emmettTypeId('Other')]: true }, typeId));
  });

  void it('does not match a local symbol with the same description', () => {
    assertFalse(
      hasTypeId({ [Symbol('@event-driven-io/emmett/Sample')]: true }, typeId),
    );
  });

  void it('does not match values that are not objects', () => {
    assertFalse(hasTypeId(null, typeId));
    assertFalse(hasTypeId(undefined, typeId));
    assertFalse(hasTypeId('Sample', typeId));
    assertFalse(hasTypeId(42, typeId));
  });
});
