import { describe, it } from 'node:test';
import { ReadableStream } from 'web-streams-polyfill';
import { EmmettError } from '../../errors';
import { assertDeepEqual, assertEqual, assertRejects } from '../../testing';
import { single, singleOrDefault } from './single';

// Sample complex object type
type ComplexObject = { id: number; name: string };

void describe('Stream Utility Functions', () => {
  void describe('singleOrDefault', () => {
    void it('returns the single item if available', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('only');
          controller.close();
        },
      });

      const result = await singleOrDefault(stream, 'default');
      assertEqual(result, 'only');
    });

    void it('returns the default value if the stream is empty', async () => {
      const stream = new ReadableStream<string | null>({
        start(controller) {
          controller.close();
        },
      });

      const result = await singleOrDefault(stream, 'default');
      assertEqual(result, 'default');
    });

    void it('returns null if defaultValue is null and the stream is empty', async () => {
      const stream = new ReadableStream<string | null>({
        start(controller) {
          controller.close();
        },
      });

      const result = await singleOrDefault(stream, null);
      assertEqual(result, null);
    });

    void it('throws an error if the stream has more than one item', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('first');
          controller.enqueue('second');
          controller.close();
        },
      });

      await assertRejects(
        singleOrDefault(stream, 'default'),
        new EmmettError(
          'Stream contained more than one item while expecting to have single!',
        ),
      );
    });

    void it('handles a stream where the single item is null', async () => {
      const stream = new ReadableStream<string | null>({
        start(controller) {
          controller.enqueue(null);
          controller.close();
        },
      });

      const result = await singleOrDefault(stream, 'default');
      assertEqual(result, 'default');
    });

    void it('should work with complex objects', async () => {
      const stream = new ReadableStream<ComplexObject>({
        start(controller) {
          controller.enqueue({ id: 1, name: 'Test' });
          controller.close();
        },
      });

      const defaultObject: ComplexObject = { id: 0, name: 'Default' };
      const result = await singleOrDefault(stream, defaultObject);
      assertDeepEqual(result, { id: 1, name: 'Test' });
    });

    void it('returns default complex object if stream is empty', async () => {
      const stream = new ReadableStream<ComplexObject | null>({
        start(controller) {
          controller.close();
        },
      });

      const defaultObject: ComplexObject = { id: 0, name: 'Default' };
      const result = await singleOrDefault(stream, defaultObject);
      assertDeepEqual(result, defaultObject);
    });

    void it('handles no default value provided', async () => {
      const stream = new ReadableStream<string | null>({
        start(controller) {
          controller.enqueue(null);
          controller.close();
        },
      });

      const result = await singleOrDefault(stream);
      assertEqual(result, null);
    });
  });

  void describe('single', () => {
    void it('returns the single item if available', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('only');
          controller.close();
        },
      });

      const result = await single(stream);
      assertEqual(result, 'only');
    });

    void it('throws an error if the stream is empty', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.close();
        },
      });

      await assertRejects(
        single(stream),
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
        single(stream),
        new EmmettError('Value was undefined!'),
      );
    });

    void it('throws an error if the stream has more than one item', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('first');
          controller.enqueue('second');
          controller.close();
        },
      });

      await assertRejects(
        single(stream),
        new EmmettError(
          'Stream contained more than one item while expecting to have single!',
        ),
      );
    });

    void it('should work with complex objects', async () => {
      const stream = new ReadableStream<ComplexObject>({
        start(controller) {
          controller.enqueue({ id: 1, name: 'Test' });
          controller.close();
        },
      });

      const result = await single(stream);
      assertDeepEqual(result, { id: 1, name: 'Test' });
    });
  });
});
