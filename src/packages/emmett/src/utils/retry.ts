import retry from 'async-retry';
import { EmmettError } from '../errors';
import { JSONParser } from '../serialization';

export type AsyncRetryOptions<T = unknown> = retry.Options & {
  shouldRetryResult?: (result: T) => boolean;
  shouldRetryError?: (error?: unknown) => boolean;
};

export const NoRetries: AsyncRetryOptions = { retries: 0 };

export const asyncRetry = async <T>(
  fn: () => Promise<T>,
  opts?: AsyncRetryOptions<T>,
): Promise<T> => {
  if (opts === undefined || opts.retries === 0) return fn();

  return retry(
    async (bail) => {
      try {
        const result = await fn();

        if (opts?.shouldRetryResult && opts.shouldRetryResult(result)) {
          throw new EmmettError(
            `Retrying because of result: ${JSONParser.stringify(result)}`,
          );
        }
        return result;
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
