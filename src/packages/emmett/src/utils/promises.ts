export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

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
  })();

  return result;
};
