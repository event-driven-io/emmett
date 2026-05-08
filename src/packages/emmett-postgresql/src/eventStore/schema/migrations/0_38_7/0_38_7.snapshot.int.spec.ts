import { expect, test } from 'vitest';
import { schema_0_38_7 } from './0_38_7.snapshot';

test('0.38.7 schema is unchanged', () => {
  const result = schema_0_38_7;
  expect(result).toMatchSnapshot();
});
