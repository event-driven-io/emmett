export const singleOrNull = async <T>(
  getResult: Promise<T[]>,
): Promise<T | null> => {
  const result = await getResult;

  if (result.length > 1) throw new Error('Query had more than one result');

  return result.length > 0 ? (result[0] ?? null) : null;
};

export const single = async <T>(getResult: Promise<T[]>): Promise<T> => {
  const result = await getResult;

  if (result.length === 0) throw new Error("Query didn't return any result");

  if (result.length > 1) throw new Error('Query had more than one result');

  return result[0]!;
};
