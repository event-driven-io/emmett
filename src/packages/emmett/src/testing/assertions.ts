import type { DefaultRecord } from '../typing';

export const isSubset = (superObj: unknown, subObj: unknown): boolean => {
  const sup = superObj as DefaultRecord;
  const sub = subObj as DefaultRecord;

  return Object.keys(sub).every((ele: string) => {
    if (typeof sub[ele] == 'object') {
      return isSubset(sup[ele], sub[ele]);
    }
    return sub[ele] === sup[ele];
  });
};

export const assertMatches = (actual: unknown, expected: unknown) => {
  if (!isSubset(actual, expected))
    throw Error(
      `subObj:\n${JSON.stringify(expected)}\nis not subset of\n${JSON.stringify(actual)}`,
    );
};
