export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Waits, but gives up the moment the signal aborts, so a source sitting on its
 * polling delay tears down as promptly as one mid-read.
 */
export const delayOrAbort = (
  ms: number,
  signal: AbortSignal,
  options?: { unref?: boolean },
): Promise<void> =>
  new Promise<void>((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (options?.unref) timeout.unref();

    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });

export type AsyncAwaiter<T = void> = {
  wait: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reject: (reason?: any) => void;
  reset: () => void;
};

// TODO: Remove this after migrating to Node 22
export const asyncAwaiter = <T = void>(): AsyncAwaiter<T> => {
  const result: AsyncAwaiter<T> = {} as AsyncAwaiter<T>;

  (result.reset = () => {
    result.wait = new Promise<T>((res, rej) => {
      result.resolve = res;
      result.reject = rej;
    });
    void result.wait.catch(() => {
      // Prevent Node.js unhandled rejection warnings for deferred promises
      // that may be rejected before a consumer attaches a handler.
      // See: https://nodejs.org/api/process.html#event-unhandledrejection
    });
  })();

  return result;
};
