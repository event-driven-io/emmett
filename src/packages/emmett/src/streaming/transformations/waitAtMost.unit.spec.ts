import { describe, it } from 'node:test';
import { assertDeepEqual, assertEqual } from '../../testing';
import { collect } from '../collectors/collect';
import { fromArray } from '../generators/fromArray';
import { waitAtMost } from './waitAtMost'; // Adjust this import path accordingly

void describe('waitAtMost transform', () => {
  void it('stops transforming after the specified wait time', async () => {
    const events = [1, 2, 3];
    const waitTimeInMs = 10;

    const sourceStream = fromArray(events);
    const transformedStream = sourceStream.pipeThrough(
      waitAtMost(waitTimeInMs),
    );

    const reader = transformedStream.getReader();
    const firstResult = await reader.read();
    assertEqual(firstResult.value, 1);

    await new Promise((resolve) => setTimeout(resolve, 15));

    const secondResult = await reader.read();
    assertEqual(secondResult.done, true);
  });

  void it('transform all events within the wait time', async () => {
    const events = [1, 2, 3];
    const waitTimeInMs = 20;

    const sourceStream = fromArray(events);
    const transformedStream = sourceStream.pipeThrough(
      waitAtMost(waitTimeInMs),
    );

    const result = await collect(transformedStream);
    assertDeepEqual(result, [1, 2, 3]);
  });

  void it('handles an empty stream correctly', async () => {
    const events: number[] = [];
    const waitTimeInMs = 10;

    const sourceStream = fromArray(events);
    const transformedStream = sourceStream.pipeThrough(
      waitAtMost(waitTimeInMs),
    );

    const result = await collect(transformedStream);
    assertDeepEqual(result, []);
  });

  void it('stops transforming exactly after the wait time', async () => {
    const events = [1, 2, 3];
    const waitTimeInMs = 10;

    const sourceStream = fromArray(events);
    const transformedStream = sourceStream.pipeThrough(
      waitAtMost(waitTimeInMs),
    );

    const reader = transformedStream.getReader();
    const firstResult = await reader.read();
    assertEqual(firstResult.value, 1);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondResult = await reader.read();
    assertEqual(secondResult.done, true);
  });

  void it('should not transform any events after the wait time', async () => {
    const events = [1, 2, 3];
    const waitTimeInMs = 5;

    const sourceStream = fromArray(events);
    const transformedStream = sourceStream.pipeThrough(
      waitAtMost(waitTimeInMs),
    );

    const reader = transformedStream.getReader();
    const firstResult = await reader.read();
    assertEqual(firstResult.value, 1);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondResult = await reader.read();
    assertEqual(secondResult.done, true);
  });
});
