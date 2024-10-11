import retry from 'async-retry';

export type AsyncRetryOptions = retry.Options & {
  shouldRetryError?: (error: unknown) => boolean;
};

export const NoRetries: AsyncRetryOptions = { retries: 0 };

export const asyncRetry = async <T>(
  fn: () => Promise<T>,
  opts?: AsyncRetryOptions,
): Promise<T> => {
  if (opts === undefined || opts.retries === 0) return fn();

  return retry(
    async (bail) => {
      try {
        return await fn();
      } catch (error) {
        if (opts?.shouldRetryError && !opts.shouldRetryError(error)) {
          bail(error as Error);
        }
        throw error;
      }
    },
    opts ?? { retries: 0 },
  );
};
