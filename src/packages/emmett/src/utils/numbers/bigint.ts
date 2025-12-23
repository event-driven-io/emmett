export const toNormalizedString = (value: bigint): string =>
  value.toString().padStart(19, '0');

export const bigInt = {
  toNormalizedString,
};
