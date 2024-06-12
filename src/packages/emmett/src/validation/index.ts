import { ValidationError } from '../errors';

export const enum ValidationErrors {
  NOT_A_NONEMPTY_STRING = 'NOT_A_NONEMPTY_STRING',
  NOT_A_POSITIVE_NUMBER = 'NOT_A_POSITIVE_NUMBER',
  NOT_AN_UNSIGNED_BIGINT = 'NOT_AN_UNSIGNED_BIGINT',
}

export const isNumber = (val: unknown): val is number =>
  typeof val === 'number' && val === val;

export const isString = (val: unknown): val is string =>
  typeof val === 'string';

export const assertNotEmptyString = (value: unknown): string => {
  if (!isString(value) || value.length === 0) {
    throw new ValidationError(ValidationErrors.NOT_A_NONEMPTY_STRING);
  }
  return value;
};

export const assertPositiveNumber = (value: unknown): number => {
  if (!isNumber(value) || value <= 0) {
    throw new ValidationError(ValidationErrors.NOT_A_POSITIVE_NUMBER);
  }
  return value;
};

export const assertUnsignedBigInt = (value: string): bigint => {
  const number = BigInt(value);
  if (number < 0) {
    throw new ValidationError(ValidationErrors.NOT_AN_UNSIGNED_BIGINT);
  }
  return number;
};

export * from './dates';
