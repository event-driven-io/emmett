import assert from 'node:assert';
import { describe, it } from 'vitest';
import { withNestedTransactionOptions } from './transactionOptions';

describe('withNestedTransactionOptions', () => {
  it('enables nested transactions by default', () => {
    const options = withNestedTransactionOptions();

    assert.deepStrictEqual(options.transactionOptions, {
      allowNestedTransactions: true,
    });
  });

  it('preserves existing transaction options', () => {
    const options = withNestedTransactionOptions({
      pooled: true,
      transactionOptions: {
        useSavepoints: true,
        isolationLevel: 'SERIALIZABLE',
      },
    });

    assert.deepStrictEqual(options.transactionOptions, {
      allowNestedTransactions: true,
      useSavepoints: true,
      isolationLevel: 'SERIALIZABLE',
    });
  });

  it('respects explicitly disabled nested transactions', () => {
    const options = withNestedTransactionOptions({
      transactionOptions: {
        allowNestedTransactions: false,
        useSavepoints: true,
      },
    });

    assert.deepStrictEqual(options.transactionOptions, {
      allowNestedTransactions: false,
      useSavepoints: true,
    });
  });
});
