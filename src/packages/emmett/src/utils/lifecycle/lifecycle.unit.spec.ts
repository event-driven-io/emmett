import { describe, expect, it, vi } from 'vitest';
import { lifecycle } from './lifecycle';

describe('lifecycle', () => {
  it('starts immediately and shuts down once', async () => {
    const start = vi.fn();
    const shutdown = vi.fn();

    const runtime = lifecycle({ start, shutdown });

    expect(start).toHaveBeenCalledOnce();

    await Promise.all([runtime.shutdown(), runtime.shutdown()]);

    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('waits for startup before shutting down', async () => {
    let finishStart = () => {};
    const start = new Promise<void>((resolve) => {
      finishStart = resolve;
    });
    const shutdown = vi.fn();
    const runtime = lifecycle({ start: () => start, shutdown });

    const shuttingDown = runtime.shutdown();

    expect(shutdown).not.toHaveBeenCalled();

    finishStart();
    await shuttingDown;

    expect(shutdown).toHaveBeenCalledOnce();
  });
});
