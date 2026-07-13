export type ShutdownHandler = () => void | Promise<void>;

/**
 * Registers handlers for OS signals to enable graceful shutdown.
 * Handles SIGTERM and SIGINT by default.
 * Works in Node.js, Bun, and Deno. Safely no-ops in Browser/Cloudflare Workers.
 *
 * @param handler - Function to call when shutdown signal is received
 * @returns Cleanup function to unregister the handlers
 */
export const onShutdown = (handler: ShutdownHandler): (() => void) => {
  const signals = ['SIGTERM', 'SIGINT'] as const;

  // Node.js/Bun
  if (typeof process !== 'undefined' && typeof process.on === 'function') {
    for (const signal of signals) {
      process.on(signal, handler);
    }
    return () => {
      for (const signal of signals) {
        process.off(signal, handler);
      }
    };
  }

  // Deno
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const deno = (globalThis as any).Deno;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (deno && typeof deno.addSignalListener === 'function') {
    for (const signal of signals) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      deno.addSignalListener(signal, handler);
    }
    return () => {
      for (const signal of signals) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        deno.removeSignalListener(signal, handler);
      }
    };
  }

  // Browser/Cloudflare Workers: no-op
  return () => {};
};
