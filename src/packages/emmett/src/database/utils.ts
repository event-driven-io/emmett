import { ConcurrencyInMemoryDatabaseError } from '../errors';
import { JSONParser } from '../serialization';
import type {
  DatabaseHandleOptionErrors,
  ExpectedDocumentVersion,
  ExpectedDocumentVersionGeneral,
  ExpectedDocumentVersionValue,
  OperationResult,
} from './types';

export const isGeneralExpectedDocumentVersion = (
  version: ExpectedDocumentVersion | undefined,
): version is ExpectedDocumentVersionGeneral => {
  return (
    version === 'DOCUMENT_DOES_NOT_EXIST' ||
    version === 'DOCUMENT_EXISTS' ||
    version === 'NO_CONCURRENCY_CHECK'
  );
};

export const expectedVersionValue = (
  version: ExpectedDocumentVersion | undefined,
): ExpectedDocumentVersionValue | null =>
  version === undefined || isGeneralExpectedDocumentVersion(version)
    ? null
    : version;

export const operationResult = <T extends OperationResult>(
  result: Omit<T, 'assertSuccess' | 'acknowledged' | 'assertSuccessful'>,
  options: {
    operationName: string;
    collectionName: string;
    errors?: DatabaseHandleOptionErrors;
  },
): T => {
  const operationResult: T = {
    ...result,
    acknowledged: true,
    successful: result.successful,
    assertSuccessful: (errorMessage?: string) => {
      const { successful } = result;
      const { operationName, collectionName } = options;

      if (!successful)
        throw new ConcurrencyInMemoryDatabaseError(
          errorMessage ??
            `${operationName} on ${collectionName} failed. Expected document state does not match current one! Result: ${JSONParser.stringify(result)}!`,
        );
    },
  } as T;

  if (options.errors?.throwOnOperationFailures)
    operationResult.assertSuccessful();

  return operationResult;
};
