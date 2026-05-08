import { expect, test } from 'vitest';
import { migrations_0_38_7 } from '.';

test('0.38.7 schema is unchanged', () => {
  const result = migrations_0_38_7;
  expect(result).toMatchSnapshot();
});
