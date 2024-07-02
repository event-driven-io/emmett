import { describe, it } from 'node:test';
import { EmmettError } from '../../errors';
import { assertDeepEqual, assertEqual, assertRejects } from '../../testing';
import { fromArray } from '../generators/fromArray';
import { first, firstOrDefault } from './first';

// Sample complex object type
type ComplexObject = { id: number; name: string };

void describe('Stream Utility Functions', () => {
  void describe('firstOrDefault', () => {
    void it('returns the first item if available', async () => {
      const stream = fromArray(['first', 'second']);

      const result = await firstOrDefault(stream, 'default');
      assertEqual(result, 'first');
    });

    void it('returns the first item if the single item is in the stream', async () => {
      const stream = fromArray(['first']);

      const result = await firstOrDefault(stream, 'default');
      assertEqual(result, 'first');
    });

    void it('returns the default value if the stream is empty', async () => {
      const stream = fromArray<string | null>([]);

      const result = await firstOrDefault(stream, 'default');
      assertEqual(result, 'default');
    });

    void it('handles a stream where the first item is null', async () => {
      const stream = fromArray<string | null>([null, 'second']);

      const result = await firstOrDefault(stream, 'default');
      assertEqual(result, 'default');
    });

    void it('returns null if defaultValue is null and the stream is empty', async () => {
      const stream = fromArray<string | null>([]);

      const result = await firstOrDefault(stream, null);
      assertEqual(result, null);
    });

    void it('should work with complex objects', async () => {
      const stream = fromArray<ComplexObject>([
        { id: 1, name: 'First' },
        { id: 1, name: 'Second' },
      ]);

      const defaultObject: ComplexObject = { id: 0, name: 'Default' };
      const result = await firstOrDefault(stream, defaultObject);
      assertDeepEqual(result, { id: 1, name: 'First' });
    });

    void it('returns default complex object if stream is empty', async () => {
      const stream = fromArray<ComplexObject | null>([]);

      const defaultObject: ComplexObject = { id: 0, name: 'Default' };
      const result = await firstOrDefault(stream, defaultObject);
      assertDeepEqual(result, defaultObject);
    });

    void it('handles no default value provided', async () => {
      const stream = fromArray<string | null>([null]);

      const result = await firstOrDefault(stream);
      assertEqual(result, null);
    });
  });

  void describe('first', () => {
    void it('returns the first item if available', async () => {
      const stream = fromArray(['first', 'second']);

      const result = await first(stream);
      assertEqual(result, 'first');
    });

    void it('returns the first item if single item is in the stream', async () => {
      const stream = fromArray(['first']);

      const result = await first(stream);
      assertEqual(result, 'first');
    });

    void it('throws an error if the stream is empty', async () => {
      const stream = fromArray([]);

      await assertRejects(
        first(stream),
        new EmmettError('Cannot read first item as stream was empty!'),
      );
    });

    void it('throws an error if the value is undefined', async () => {
      const stream = fromArray([undefined as unknown as string]); // Simulating undefined value

      await assertRejects(
        first(stream),
        new EmmettError('Value was undefined!'),
      );
    });
  });
});
