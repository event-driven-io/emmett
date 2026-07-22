export type NestedTransactionOptions = {
  allowNestedTransactions?: boolean | undefined;
};

export type ConnectionOptionsWithTransactions<
  ConnectionOptions extends object = object,
  TransactionOptions extends NestedTransactionOptions =
    NestedTransactionOptions,
> = Omit<ConnectionOptions, 'transactionOptions'> & {
  transactionOptions: TransactionOptions;
};

export const withNestedTransactionOptions = <
  ConnectionOptions extends object = object,
  TransactionOptions extends NestedTransactionOptions =
    NestedTransactionOptions,
>(
  connectionOptions?: ConnectionOptions & {
    transactionOptions?: TransactionOptions | undefined;
  },
  defaultTransactionOptions?: TransactionOptions,
): ConnectionOptionsWithTransactions<ConnectionOptions, TransactionOptions> => {
  const currentTransactionOptions = connectionOptions?.transactionOptions;

  return {
    ...(connectionOptions ?? ({} as ConnectionOptions)),
    transactionOptions: {
      ...(defaultTransactionOptions ?? ({} as TransactionOptions)),
      ...(currentTransactionOptions ?? ({} as TransactionOptions)),
      allowNestedTransactions:
        currentTransactionOptions?.allowNestedTransactions ??
        defaultTransactionOptions?.allowNestedTransactions ??
        true,
    },
  };
};
