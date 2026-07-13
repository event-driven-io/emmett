import { describe, expect, it, vi } from 'vitest';
import { onShutdown } from './gracefulShutdown';

describe('onShutdown', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)(
    'runs the shutdown handler on %s',
    (signal) => {
      const handler = vi.fn();
      const stopListening = onShutdown(handler);

      process.emit(signal);

      expect(handler).toHaveBeenCalledOnce();
      stopListening();
    },
  );

  it('stops listening after unregistering', () => {
    const handler = vi.fn();
    const stopListening = onShutdown(handler);

    stopListening();
    process.emit('SIGTERM');

    expect(handler).not.toHaveBeenCalled();
  });
});
