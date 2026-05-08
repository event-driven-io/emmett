import { expect, test } from 'vitest';
import { schema_0_36_0 } from './0_36_0.snapshot';

test('0.36.0 schema is unchanged', () => {
  const result = schema_0_36_0;
  expect(result).toMatchSnapshot();
});
