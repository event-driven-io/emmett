import { expect, test } from 'vitest';
import { migrations_0_42_0 } from '.';

test('0.42.0 schema is unchanged', () => {
  const result = migrations_0_42_0;
  expect(result).toMatchSnapshot();
});
