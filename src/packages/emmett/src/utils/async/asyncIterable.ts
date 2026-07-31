export const asyncIterable =
  <T>(items: T[], onDone?: () => void) =>
  () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    const iterable = (async function* (): AsyncIterableIterator<T> {
      try {
        yield* items;
      } finally {
        onDone?.();
      }
    })();

    return iterable;
  };
