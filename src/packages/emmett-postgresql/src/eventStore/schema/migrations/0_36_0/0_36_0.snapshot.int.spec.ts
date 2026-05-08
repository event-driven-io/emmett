import { expect, test } from 'vitest';
import { migrations_0_36_0 } from '.';

test('0.36.0 schema is unchanged', () => {
  const result = migrations_0_36_0;
  expect(result).toMatchSnapshot();
});
