import { describe, it } from 'node:test';
import { ReadableStream } from 'web-streams-polyfill';
import { EmmettError } from '../../errors';
import { assertDeepEqual, assertEqual, assertRejects } from '../../testing';
import { last, lastOrDefault } from './last';

// Sample complex object type
type ComplexObject = { id: number; name: string };

void describe('Stream Utility Functions', () => {
  void describe('lastOrDefault', () => {
    void it('returns the last item if available', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('first');
          controller.enqueue('last');
          controller.close();
        },
      });

      const result = await lastOrDefault(stream, 'default');
      assertEqual(result, 'last');
    });

    void it('returns the default value if the stream is empty', async () => {
      const stream = new ReadableStream<string | null>({
        start(controller) {
          controller.close();
        },
      });

      const result = await lastOrDefault(stream, 'default');
      assertEqual(result, 'default');
    });

    void it('handles a stream where the last item is null', async () => {
      const stream = new ReadableStream<string | null>({
        start(controller) {
          controller.enqueue('second');
          controller.enqueue(null);
          controller.close();
        },
      });

      const result = await lastOrDefault(stream, 'default');
      assertEqual(result, 'default');
    });

    void it('returns null if defaultValue is null and the stream is empty', async () => {
      const stream = new ReadableStream<string | null>({
        start(controller) {
          controller.close();
        },
      });

      const result = await lastOrDefault(stream, null);
      assertEqual(result, null);
    });

    void it('should work with complex objects', async () => {
      const stream = new ReadableStream<ComplexObject>({
        start(controller) {
          controller.enqueue({ id: 1, name: 'First' });
          controller.enqueue({ id: 1, name: 'Last' });
          controller.close();
        },
      });

      const defaultObject: ComplexObject = { id: 0, name: 'Default' };
      const result = await lastOrDefault(stream, defaultObject);
      assertDeepEqual(result, { id: 1, name: 'Last' });
    });

    void it('returns default complex object if stream is empty', async () => {
      const stream = new ReadableStream<ComplexObject | null>({
        start(controller) {
          controller.close();
        },
      });

      const defaultObject: ComplexObject = { id: 0, name: 'Default' };
      const result = await lastOrDefault(stream, defaultObject);
      assertDeepEqual(result, defaultObject);
    });

    void it('handles no default value provided', async () => {
      const stream = new ReadableStream<string | null>({
        start(controller) {
          controller.enqueue(null);
          controller.close();
        },
      });

      const result = await lastOrDefault(stream);
      assertEqual(result, null);
    });
  });

  void describe('last', () => {
    void it('returns the last item if available', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('first');
          controller.enqueue('last');
          controller.close();
        },
      });

      const result = await last(stream);
      assertEqual(result, 'last');
    });

    void it('returns the first item if a single item is in the stream', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('last');
          controller.close();
        },
      });

      const result = await last(stream);
      assertEqual(result, 'last');
    });

    void it('throws an error if the stream is empty', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.close();
        },
      });

      await assertRejects(
        last(stream),
        new EmmettError('Cannot read last item as stream was empty!'),
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
        last(stream),
        new EmmettError('Value was undefined!'),
      );
    });
  });
});
