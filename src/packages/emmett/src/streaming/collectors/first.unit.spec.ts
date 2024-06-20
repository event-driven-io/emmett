import { describe, it } from 'node:test';
import { ReadableStream } from 'web-streams-polyfill';
import { EmmettError } from '../../errors';
import { assertDeepEqual, assertEqual, assertRejects } from '../../testing';
import { first, firstOrDefault } from './first';

// Sample complex object type
type ComplexObject = { id: number; name: string };

void describe('Stream Utility Functions', () => {
  void describe('firstOrDefault', () => {
    void it('returns the first item if available', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('first');
          controller.enqueue('second');
          controller.close();
        },
      });

      const result = await firstOrDefault(stream, 'default');
      assertEqual(result, 'first');
    });

    void it('returns the default value if the stream is empty', async () => {
      const stream = new ReadableStream<string | null>({
        start(controller) {
          controller.close();
        },
      });

      const result = await firstOrDefault(stream, 'default');
      assertEqual(result, 'default');
    });

    void it('handles a stream where the first item is null', async () => {
      const stream = new ReadableStream<string | null>({
        start(controller) {
          controller.enqueue(null);
          controller.enqueue('second');
          controller.close();
        },
      });

      const result = await firstOrDefault(stream, 'default');
      assertEqual(result, 'default');
    });

    void it('returns null if defaultValue is null and the stream is empty', async () => {
      const stream = new ReadableStream<string | null>({
        start(controller) {
          controller.close();
        },
      });

      const result = await firstOrDefault(stream, null);
      assertEqual(result, null);
    });

    void it('should work with complex objects', async () => {
      const stream = new ReadableStream<ComplexObject>({
        start(controller) {
          controller.enqueue({ id: 1, name: 'Test' });
          controller.close();
        },
      });

      const defaultObject: ComplexObject = { id: 0, name: 'Default' };
      const result = await firstOrDefault(stream, defaultObject);
      assertDeepEqual(result, { id: 1, name: 'Test' });
    });

    void it('returns default complex object if stream is empty', async () => {
      const stream = new ReadableStream<ComplexObject | null>({
        start(controller) {
          controller.close();
        },
      });

      const defaultObject: ComplexObject = { id: 0, name: 'Default' };
      const result = await firstOrDefault(stream, defaultObject);
      assertDeepEqual(result, defaultObject);
    });

    void it('handles no default value provided', async () => {
      const stream = new ReadableStream<string | null>({
        start(controller) {
          controller.enqueue(null);
          controller.close();
        },
      });

      const result = await firstOrDefault(stream);
      assertEqual(result, null);
    });
  });

  void describe('first', () => {
    void it('returns the first item if available', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('first');
          controller.close();
        },
      });

      const result = await first(stream);
      assertEqual(result, 'first');
    });

    void it('throws an error if the stream is empty', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.close();
        },
      });

      await assertRejects(
        first(stream),
        new EmmettError('Cannot read first item as stream was empty!'),
      );
    });

    void it('throws an error if the value is undefined', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue(undefined as unknown as string); // Simulating undefined value
          controller.close();
        },
      });

      await assertRejects(
        first(stream),
        new EmmettError('Value was undefined!'),
      );
    });
  });
});
