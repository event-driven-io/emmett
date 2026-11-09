import { describe, it } from 'vitest';
import { assertDeepEqual, assertEqual } from '../../testing';
import {
  isNumericSchemaVersion,
  resolveSchemaVersion,
  withoutSchemaVersion,
} from './schemaVersion';

describe('Numeric schema version', () => {
  it.each([
    { value: 2, numeric: true },
    { value: 0, numeric: true },
    { value: '2', numeric: true },
    { value: '12', numeric: true },
    { value: '"1"', numeric: false },
    { value: '2.0', numeric: false },
    { value: 'two', numeric: false },
    { value: 'v2', numeric: false },
    { value: '', numeric: false },
    { value: 2.5, numeric: false },
    { value: null, numeric: false },
    { value: undefined, numeric: false },
  ])('treats $value as numeric: $numeric', ({ value, numeric }) => {
    assertEqual(isNumericSchemaVersion(value), numeric);
  });
});

describe('Schema version read rule', () => {
  it('uses the stored version when it is a number', () => {
    assertEqual(resolveSchemaVersion(3, { schemaVersion: '2' }), 3);
  });

  it('uses the stored version when it is a numeric string', () => {
    assertEqual(resolveSchemaVersion('3', { schemaVersion: '2' }), 3);
  });

  it('uses the metadata version when there is no usable stored version and the metadata has a numeric version', () => {
    assertEqual(resolveSchemaVersion(undefined, { schemaVersion: '2' }), 2);
  });

  it('uses the metadata version when the stored version is not numeric', () => {
    assertEqual(resolveSchemaVersion('v3', { schemaVersion: '2' }), 2);
  });

  it('uses version 1 when there is no usable stored version and the metadata has no version', () => {
    assertEqual(resolveSchemaVersion(undefined, { tenantId: 'acme' }), 1);
  });

  it('uses version 1 when there is no usable stored version and the metadata version is not numeric', () => {
    assertEqual(resolveSchemaVersion(undefined, { schemaVersion: 'v2' }), 1);
  });

  it('uses version 1 when there is no stored version and no metadata', () => {
    assertEqual(resolveSchemaVersion(undefined, undefined), 1);
  });
});

describe('Metadata without schema version', () => {
  it('removes the schema version and keeps every other key', () => {
    assertDeepEqual(
      withoutSchemaVersion({
        schemaVersion: '2',
        tenantId: 'acme',
        streamName: 'cart-1',
      }),
      { tenantId: 'acme', streamName: 'cart-1' },
    );
  });

  it('keeps the metadata unchanged when it has no schema version', () => {
    assertDeepEqual(withoutSchemaVersion({ tenantId: 'acme' }), {
      tenantId: 'acme',
    });
  });
});
