export async function reduceAsync<T, R>(
  items: T[],
  fn: (accumulator: R, item: T, index: number) => Promise<R>,
  initial: R,
): Promise<R> {
  let accumulator = initial;
  for (let i = 0; i < items.length; i++) {
    accumulator = await fn(accumulator, items[i]!, i);
  }
  return accumulator;
}
