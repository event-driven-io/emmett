export const sum = (
  iterator: Iterator<number, number, number> | Iterator<number>,
) => {
  let value,
    done: boolean | undefined,
    sum = 0;
  do {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    ({ value, done } = iterator.next());
    sum += value || 0;
  } while (!done);
  return sum;
};
