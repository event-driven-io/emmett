import assert from 'node:assert';
import type { D1TransactionOptions } from '@event-driven-io/dumbo/cloudflare';
import { describe, it } from 'vitest';
import { d1EventStoreDriver } from '../cloudflare';
import { sqlite3EventStoreDriver } from '../sqlite3';
import { withNestedTransactionOptions } from './transactionOptions';

describe('withNestedTransactionOptions', () => {
  it('enables nested transactions by default', () => {
    const options = withNestedTransactionOptions();

    assert.deepStrictEqual(options.transactionOptions, {
      allowNestedTransactions: true,
    });
  });

  it('preserves existing transaction options and defaults', () => {
    const options = withNestedTransactionOptions<object, D1TransactionOptions>(
      {
        transactionOptions: {
          readonly: true,
        },
      },
      {
        mode: 'session_based',
      },
    );

    assert.deepStrictEqual(options.transactionOptions, {
      allowNestedTransactions: true,
      mode: 'session_based',
      readonly: true,
    } satisfies D1TransactionOptions);
  });

  it('respects explicitly disabled nested transactions', () => {
    const options = withNestedTransactionOptions({
      transactionOptions: {
        allowNestedTransactions: false,
        readonly: true,
      },
    });

    assert.deepStrictEqual(options.transactionOptions, {
      allowNestedTransactions: false,
      readonly: true,
    });
  });
});

describe('SQLite event store drivers', () => {
  it('maps sqlite3 options with nested transactions enabled by default', () => {
    const options = sqlite3EventStoreDriver.mapToDumboOptions({
      fileName: 'test.db',
      connectionOptions: {
        transactionOptions: {
          readonly: true,
        },
      },
    });

    assert.deepStrictEqual(options.transactionOptions, {
      allowNestedTransactions: true,
      readonly: true,
    });
  });

  it('maps D1 options with session mode and respects disabled nested transactions', () => {
    const options = d1EventStoreDriver.mapToDumboOptions({
      database: {} as never,
      connectionOptions: {
        transactionOptions: {
          allowNestedTransactions: false,
        },
      },
    });

    assert.deepStrictEqual(options.transactionOptions, {
      allowNestedTransactions: false,
      mode: 'session_based',
    } satisfies D1TransactionOptions);
  });
});
