export const hasDuplicates = <ArrayItem, Mapped>(
  array: ArrayItem[],
  predicate: (value: ArrayItem, index: number, array: ArrayItem[]) => Mapped,
) => {
  const mapped = array.map(predicate);
  const uniqueValues = new Set(mapped);

  return uniqueValues.size < mapped.length;
};

export const getDuplicates = <ArrayItem, Mapped>(
  array: ArrayItem[],
  predicate: (value: ArrayItem, index: number, array: ArrayItem[]) => Mapped,
): ArrayItem[] => {
  const map = new Map<Mapped, ArrayItem[]>();

  for (let i = 0; i < array.length; i++) {
    const item = array[i]!;
    const key = predicate(item, i, array);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(item);
  }

  return Array.from(map.values())
    .filter((group) => group.length > 1)
    .flat();
};
