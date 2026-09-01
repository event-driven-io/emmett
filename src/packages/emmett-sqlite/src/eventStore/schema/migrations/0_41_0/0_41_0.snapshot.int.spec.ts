import { expect, test } from 'vitest';
import { migrations_0_41_0 } from '.';

test('0.41.0 schema is unchanged', () => {
  const result = migrations_0_41_0;
  expect(result).toMatchSnapshot();
});
