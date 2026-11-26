import { getEventListeners } from 'node:events';
import { describe, it } from 'vitest';
import { assertEqual, assertThrowsAsync } from '../testing';
import { Aborted, orAborted } from './promises';

void describe('orAborted', () => {
  void it('resolves with the promise result when the signal does not abort', async () => {
    const controller = new AbortController();

    assertEqual(await orAborted(Promise.resolve(1), controller.signal), 1);
  });

  void it('resolves Aborted when the signal aborts while the promise is pending', async () => {
    const controller = new AbortController();
    const result = orAborted(new Promise<never>(() => {}), controller.signal);

    controller.abort();

    assertEqual(await result, Aborted);
  });

  void it('resolves Aborted when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    assertEqual(
      await orAborted(Promise.resolve(1), controller.signal),
      Aborted,
    );
  });

  void it('rejects with the promise error', async () => {
    const controller = new AbortController();

    await assertThrowsAsync(
      () => orAborted(Promise.reject(new Error('failed')), controller.signal),
      (error) => error.message === 'failed',
    );
  });

  void it('removes its abort listener once the promise resolves', async () => {
    const controller = new AbortController();

    await orAborted(Promise.resolve(1), controller.signal);

    assertEqual(getEventListeners(controller.signal, 'abort').length, 0);
  });
});
