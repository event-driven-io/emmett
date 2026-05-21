import { describe, expect, it } from 'vitest';
import { migrations_0_43_0 } from '.';
import { schemaMigration } from '..';

describe('0.43.0 schema migration', () => {
  it('0.43.0 schema is unchanged', () => {
    const result = migrations_0_43_0;
    expect(result).toMatchSnapshot();
  });

  it('0.43.0 schema is the latest one', () => {
    const result = schemaMigration;
    expect(result).toMatchSnapshot();
  });
});
