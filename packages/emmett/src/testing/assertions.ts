export const isSubset = (superObj: unknown, subObj: unknown): boolean => {
  const sup = superObj as Record<string, unknown>;
  const sub = subObj as Record<string, unknown>;

  return Object.keys(sub).every((ele: string) => {
    if (typeof sub[ele] == 'object') {
      return isSubset(
        sup[ele] as Record<string, unknown>,
        sub[ele] as Record<string, unknown>,
      );
    }
    return sub[ele] === sup[ele];
  });
};

export const assertMatches = (superObj: unknown, subObj: unknown) => {
  if (!isSubset(superObj, subObj))
    throw Error(
      `subObj:\n${JSON.stringify(subObj)}\nis not subset of\n${JSON.stringify(superObj)}`,
    );
};
