import { onShutdown } from './gracefulShutdown';

export type LifecycleHooks = {
  start?: () => void | Promise<void>;
  shutdown?: () => void | Promise<void>;
};

export type Lifecycle = {
  shutdown: () => Promise<void>;
};

export const lifecycle = (hooks: LifecycleHooks = {}): Lifecycle => {
  let started: Promise<void>;
  try {
    started = Promise.resolve(hooks.start?.());
  } catch (error) {
    started = Promise.reject(
      error instanceof Error
        ? error
        : new Error('Lifecycle startup failed', { cause: error }),
    );
  }

  let shutdownPromise: Promise<void> | undefined;
  let stopListening = () => {};

  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise;

    shutdownPromise = (async () => {
      stopListening();
      await started;
      await hooks.shutdown?.();
    })();
    return shutdownPromise;
  };

  if (hooks.shutdown !== undefined) stopListening = onShutdown(shutdown);

  return { shutdown };
};
