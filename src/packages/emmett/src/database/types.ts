/** TypeScript Omit (Exclude to be specific) does not work for objects with an "any" indexed type, and breaks discriminated unions @public */
export declare type EnhancedOmit<TRecordOrUnion, KeyUnion> =
  string extends keyof TRecordOrUnion
    ? TRecordOrUnion
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      TRecordOrUnion extends any
      ? Pick<TRecordOrUnion, Exclude<keyof TRecordOrUnion, KeyUnion>>
      : never;

export declare type WithId<TSchema> = EnhancedOmit<TSchema, '_id'> & {
  _id: string;
};
export type WithoutId<T> = Omit<T, '_id'>;

export declare type WithVersion<TSchema> = EnhancedOmit<TSchema, '_version'> & {
  _version: bigint;
};
export type WithoutVersion<T> = Omit<T, '_version'>;

export type WithIdAndVersion<TSchema> = EnhancedOmit<
  TSchema,
  '_version' | '_id'
> & {
  _id: string;
  _version: bigint;
};

export type Document = Record<string, unknown>;

export type DocumentHandler<T extends Document> = (
  document: T | null,
) => T | null;

export type ExpectedDocumentVersionGeneral =
  | 'DOCUMENT_EXISTS'
  | 'DOCUMENT_DOES_NOT_EXIST'
  | 'NO_CONCURRENCY_CHECK';

export type ExpectedDocumentVersion = bigint | ExpectedDocumentVersionGeneral;

export type ExpectedDocumentVersionValue = bigint;

export type HandleOptions = {
  expectedVersion?: ExpectedDocumentVersion;
};

export type OperationResult = {
  acknowledged: boolean;
  successful: boolean;

  assertSuccessful: (errorMessage?: string) => void;
};

export interface InsertOneResult extends OperationResult {
  insertedId: string | null;
  nextExpectedVersion: bigint;
}

export interface InsertManyResult extends OperationResult {
  insertedIds: string[];
  insertedCount: number;
}

export interface UpdateResult extends OperationResult {
  matchedCount: number;
  modifiedCount: number;
  nextExpectedVersion: bigint;
}

export interface UpdateManyResult extends OperationResult {
  matchedCount: number;
  modifiedCount: number;
}

export interface DeleteResult extends OperationResult {
  matchedCount: number;
  deletedCount: number;
}

export interface DeleteManyResult extends OperationResult {
  deletedCount: number;
}

export type HandleResult<T> =
  | (InsertOneResult & { document: WithIdAndVersion<T> })
  | (UpdateResult & { document: WithIdAndVersion<T> })
  | (DeleteResult & { document: null })
  | (OperationResult & { document: null });

export type HandleOptionErrors =
  | { throwOnOperationFailures?: boolean }
  | undefined;

export declare type OptionalId<TSchema> = EnhancedOmit<TSchema, '_id'> & {
  _id?: string;
};

export declare type OptionalVersion<TSchema> = EnhancedOmit<
  TSchema,
  '_version'
> & {
  _version?: bigint;
};

export declare type OptionalUnlessRequiredId<TSchema> = TSchema extends {
  _id: string;
}
  ? TSchema
  : OptionalId<TSchema>;

export declare type OptionalUnlessRequiredVersion<TSchema> = TSchema extends {
  _version: bigint;
}
  ? TSchema
  : OptionalVersion<TSchema>;

export declare type OptionalUnlessRequiredIdAndVersion<TSchema> =
  OptionalUnlessRequiredId<TSchema> & OptionalUnlessRequiredVersion<TSchema>;

export type InsertOneOptions = {
  expectedVersion?: Extract<
    ExpectedDocumentVersion,
    'DOCUMENT_DOES_NOT_EXIST' | 'NO_CONCURRENCY_CHECK'
  >;
};

export type InsertManyOptions = {
  expectedVersion?: Extract<
    ExpectedDocumentVersion,
    'DOCUMENT_DOES_NOT_EXIST' | 'NO_CONCURRENCY_CHECK'
  >;
};

export type UpdateOneOptions = {
  expectedVersion?: Exclude<ExpectedDocumentVersion, 'DOCUMENT_DOES_NOT_EXIST'>;
};

export type UpdateManyOptions = {
  expectedVersion?: Extract<
    ExpectedDocumentVersion,
    'DOCUMENT_EXISTS' | 'NO_CONCURRENCY_CHECK'
  >;
};

export type ReplaceOneOptions = {
  expectedVersion?: Exclude<ExpectedDocumentVersion, 'DOCUMENT_DOES_NOT_EXIST'>;
};

export type DeleteOneOptions = {
  expectedVersion?: Exclude<ExpectedDocumentVersion, 'DOCUMENT_DOES_NOT_EXIST'>;
};

export type DeleteManyOptions = {
  expectedVersion?: Extract<
    ExpectedDocumentVersion,
    'DOCUMENT_EXISTS' | 'NO_CONCURRENCY_CHECK'
  >;
};

export type FullId<
  Collection extends string,
  Id extends string,
> = `${Collection}-${Id}`;
