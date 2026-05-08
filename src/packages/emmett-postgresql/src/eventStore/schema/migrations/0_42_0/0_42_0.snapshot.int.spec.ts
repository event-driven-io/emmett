import { expect, test } from 'vitest';
import { schema_0_42_0 } from './0_42_0.snapshot';

test('0.42.0 schema is unchanged', () => {
  const result = schema_0_42_0;
  expect(result).toMatchSnapshot();
});
