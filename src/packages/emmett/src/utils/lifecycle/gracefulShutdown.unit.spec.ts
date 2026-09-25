import { describe, it } from 'vitest';
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
    assertEqual(true, called);

    cleanup();
  });

  void it('should register handler for SIGINT in Node.js', () => {
    let called = false;
    const handler = () => {
      called = true;
    };

    const cleanup = onShutdown(handler);

    process.emit('SIGINT');

    assertEqual(true, called);

    cleanup();
  });

  void it('should handle both SIGTERM and SIGINT', () => {
    let count = 0;
    const handler = () => {
      count++;
    };

    const cleanup = onShutdown(handler);

    process.emit('SIGTERM');
    assertEqual(1, count);

    process.emit('SIGINT');
    assertEqual(2, count);

    cleanup();
  });

  void it('should cleanup handlers when cleanup function is called', () => {
    let count = 0;
    const handler = () => {
      count++;
    };

    const cleanup = onShutdown(handler);

    process.emit('SIGTERM');
    assertEqual(1, count);

    cleanup();

    process.emit('SIGTERM');
    assertEqual(1, count);

    process.emit('SIGINT');
    assertEqual(1, count);
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

    assertEqual('done', asyncValue);

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

    assertEqual(1, count1);
    assertEqual(1, count2);

    cleanup1();
    process.emit('SIGTERM');

    assertEqual(1, count1);
    assertEqual(2, count2);

    cleanup2();
  });

  void it('should add one process listener per signal for many handlers', () => {
    const sigtermListeners = process.listenerCount('SIGTERM');
    const sigintListeners = process.listenerCount('SIGINT');

    const cleanups = Array.from({ length: 11 }, () => onShutdown(() => {}));

    assertEqual(sigtermListeners + 1, process.listenerCount('SIGTERM'));
    assertEqual(sigintListeners + 1, process.listenerCount('SIGINT'));

    cleanups.forEach((cleanup) => cleanup());
  });

  void it('should remove process listeners when all handlers are cleaned up', () => {
    const sigtermListeners = process.listenerCount('SIGTERM');
    const sigintListeners = process.listenerCount('SIGINT');

    const cleanups = Array.from({ length: 11 }, () => onShutdown(() => {}));
    cleanups.forEach((cleanup) => cleanup());

    assertEqual(sigtermListeners, process.listenerCount('SIGTERM'));
    assertEqual(sigintListeners, process.listenerCount('SIGINT'));
  });
});
