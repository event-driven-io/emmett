export const sum = (
  iterator: Iterator<number, number, number> | Iterator<number>,
) => {
  let value: number,
    done,
    sum = 0;
  do {
    ({ value, done } = iterator.next());
    sum += value || 0;
  } while (!done);
  return sum;
};
