import { describe, it } from 'node:test';
import { ReadableStream, TransformStream } from 'web-streams-polyfill';
import { assertEqual, assertFalse, assertOk, assertTrue } from '../../testing';
import { collect } from '../collectors/collect';
import {
  NotifyAboutNoActiveReadersStream,
  notifyAboutNoActiveReadersStream,
} from './notifyAboutNoActiveReaders';

void describe('NotifyAboutNoActiveReadersStream', () => {
  const customStreamId = 'custom-id';

  void it('should initialize with default options', () => {
    const mockCallback = () => {};
    const stream = notifyAboutNoActiveReadersStream(mockCallback);

    assertOk(stream.streamId);
  });

  void it('should initialize with custom options', () => {
    const mockCallback = () => {};
    const intervalCheckInMs = 50;

    const stream = notifyAboutNoActiveReadersStream(mockCallback, {
      streamId: customStreamId,
      intervalCheckInMs,
    });

    assertEqual(stream.streamId, customStreamId);
  });

  void it('should start and stop checking intervals correctly', async () => {
    let callbackInvoked = false;

    const mockCallback = (stream: NotifyAboutNoActiveReadersStream<number>) => {
      callbackInvoked = true;
      assertEqual(stream.streamId, customStreamId);
    };

    const stream = notifyAboutNoActiveReadersStream(mockCallback, {
      intervalCheckInMs: 10,
      streamId: customStreamId,
    });

    const reader = stream.readable.getReader();
    reader.releaseLock();

    await new Promise((resolve) => setTimeout(resolve, 20));

    assertTrue(callbackInvoked);
    assertFalse(stream.hasActiveSubscribers);
  });

  void it('triggers callback after the piped stream is fully read and closed', async () => {
    let callbackInvoked = false;
    const chunksCount = 5;

    const mockCallback = (stream: NotifyAboutNoActiveReadersStream<number>) => {
      callbackInvoked = true;
      assertEqual(stream.streamId, customStreamId);
    };

    // Create a source stream that generates some data
    const sourceStream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < chunksCount; i++) {
          controller.enqueue(i);
        }
        controller.close(); // Close the stream after enqueuing all data
      },
    });

    const stream = notifyAboutNoActiveReadersStream(mockCallback, {
      intervalCheckInMs: 10,
      streamId: customStreamId,
    });

    // Pipe the source stream into the NotifyAboutNoActiveReadersStream
    const pipedStream = sourceStream.pipeThrough(stream);

    // Read all data from the pipedStream to simulate full consumption
    const chunks = await collect(pipedStream);
    assertEqual(chunks.length, 5);

    await new Promise((resolve) => setTimeout(resolve, 20));

    assertTrue(callbackInvoked);
    assertFalse(stream.hasActiveSubscribers);
  });

  void it('detects no active readers when piped from another active stream', async () => {
    let callbackInvoked = false;
    const chunksCount = 5;

    const mockCallback = (stream: NotifyAboutNoActiveReadersStream<number>) => {
      callbackInvoked = true;
      assertEqual(stream.streamId, customStreamId);
    };

    // Create a source stream that generates some data
    const sourceStream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < chunksCount; i++) {
          controller.enqueue(i);
        }
        controller.close(); // Close the stream after enqueuing all data
      },
    });

    const anotherTransform = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
    });

    const stream = notifyAboutNoActiveReadersStream(mockCallback, {
      intervalCheckInMs: 10,
      streamId: customStreamId,
    });

    // Pipe the source stream into the NotifyAboutNoActiveReadersStream
    const pipedStream = sourceStream
      .pipeThrough(stream)
      .pipeThrough(anotherTransform);

    // Read all data from the pipedStream to simulate full consumption
    const chunks = await collect(pipedStream);
    assertEqual(chunks.length, 5);

    await new Promise((resolve) => setTimeout(resolve, 20));

    assertTrue(callbackInvoked);
    assertFalse(stream.hasActiveSubscribers);
  });
});
