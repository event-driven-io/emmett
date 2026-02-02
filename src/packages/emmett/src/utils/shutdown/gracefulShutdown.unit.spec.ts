import { describe, it } from 'node:test';
import { assertEqual, assertOk } from '../../testing';
import { onShutdown } from './gracefulShutdown';

void describe('onGracefulShutdown', () => {
  void it('should register handler for SIGTERM in Node.js', () => {
    let called = false;
    const handler = () => {
      called = true;
    };

    const cleanup = onShutdown(handler);

    assertOk(typeof cleanup === 'function');

    process.emit('SIGTERM');
    assertEqual(called, true);

    cleanup();
  });

  void it('should register handler for SIGINT in Node.js', () => {
    let called = false;
    const handler = () => {
      called = true;
    };

    const cleanup = onShutdown(handler);

    process.emit('SIGINT');

    assertEqual(called, true);

    cleanup();
  });

  void it('should handle both SIGTERM and SIGINT', () => {
    let count = 0;
    const handler = () => {
      count++;
    };

    const cleanup = onShutdown(handler);

    process.emit('SIGTERM');
    assertEqual(count, 1);

    process.emit('SIGINT');
    assertEqual(count, 2);

    cleanup();
  });

  void it('should cleanup handlers when cleanup function is called', () => {
    let count = 0;
    const handler = () => {
      count++;
    };

    const cleanup = onShutdown(handler);

    process.emit('SIGTERM');
    assertEqual(count, 1);

    cleanup();

    process.emit('SIGTERM');
    assertEqual(count, 1);

    process.emit('SIGINT');
    assertEqual(count, 1);
  });

  void it('should support async handlers', async () => {
    let asyncValue = '';
    const handler = async () => {
      await Promise.resolve();
      asyncValue = 'done';
    };

    const cleanup = onShutdown(handler);

    process.emit('SIGTERM');

    await Promise.resolve();

    assertEqual(asyncValue, 'done');

    cleanup();
  });

  void it('should allow multiple handlers to be registered independently', () => {
    let count1 = 0;
    let count2 = 0;

    const cleanup1 = onShutdown(() => {
      count1++;
    });
    const cleanup2 = onShutdown(() => {
      count2++;
    });

    process.emit('SIGTERM');

    assertEqual(count1, 1);
    assertEqual(count2, 1);

    cleanup1();
    process.emit('SIGTERM');

    assertEqual(count1, 1);
    assertEqual(count2, 2);

    cleanup2();
  });
});
