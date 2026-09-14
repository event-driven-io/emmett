import supertest, { type Response as SuperTestResponse } from 'supertest';

import {
  EmmettError,
  assertFails,
  getInMemoryEventStore,
  type EventStore,
  type InMemoryEventStore,
} from '@event-driven-io/emmett';
import type { Application } from 'express';
import type { TestRequest } from './apiSpecification';
import {
  executeFetchRequest,
  type Fetch,
  type FetchResponseAssert,
  type FetchTestRequestSetup,
  type FetchTestResponse,
} from './fetchTestClient';

export type E2EResponseAssert = (
  response: SuperTestResponse,
) => boolean | void | Promise<boolean> | Promise<void>;

export type ApiE2ESpecificationAssert = [E2EResponseAssert];

export type ApiE2ESpecification = (...givenRequests: TestRequest[]) => {
  when: (setupRequest: TestRequest) => {
    then: (verify: ApiE2ESpecificationAssert) => Promise<void>;
  };
};

type FetchApiE2ESpecification = (...givenRequests: FetchTestRequestSetup[]) => {
  when: (setupRequest: FetchTestRequestSetup) => {
    then: (verify: [FetchResponseAssert]) => Promise<void>;
  };
};

function apiE2ESpecificationFor<
  Store extends EventStore = InMemoryEventStore,
>(options: {
  getEventStore?: () => Store;
  fetch: Fetch;
  getApplication?: never;
}): FetchApiE2ESpecification;

function apiE2ESpecificationFor<
  Store extends EventStore = InMemoryEventStore,
>(options: {
  getEventStore?: () => Store;
  getApplication: (eventStore: Store) => Application;
  fetch?: never;
}): ApiE2ESpecification;
/** @deprecated Use `ApiE2ESpecification.for({ getEventStore, getApplication })` instead */
function apiE2ESpecificationFor<Store extends EventStore = InMemoryEventStore>(
  getEventStore: () => Store,
  getApplication: (eventStore: Store) => Application,
): ApiE2ESpecification;
function apiE2ESpecificationFor<Store extends EventStore = InMemoryEventStore>(
  optionsOrGetApplication:
    | (() => Store)
    | {
        getEventStore?: () => Store;
        fetch: Fetch;
        getApplication?: never;
      }
    | {
        getEventStore?: () => Store;
        getApplication: (eventStore: Store) => Application;
        fetch?: never;
      },
  getApplication?: (eventStore: Store) => Application,
): ApiE2ESpecification | FetchApiE2ESpecification {
  const resolveRequestExecutor = (): ((
    setupRequest: TestRequest | FetchTestRequestSetup,
  ) => Promise<SuperTestResponse | FetchTestResponse>) => {
    if (typeof optionsOrGetApplication === 'function' && getApplication) {
      const eventStore = optionsOrGetApplication();
      const request = supertest(getApplication(eventStore));
      return async (setupRequest) => (setupRequest as TestRequest)(request);
    }

    if (typeof optionsOrGetApplication !== 'object') {
      throw new EmmettError(
        'Invalid arguments provided to apiE2ESpecificationFor. Expected either an options object or a getEventStore function and getApplication function.',
      );
    }

    const eventStore =
      optionsOrGetApplication.getEventStore?.() ?? getInMemoryEventStore();
    if (optionsOrGetApplication.fetch !== undefined) {
      return (setupRequest) =>
        executeFetchRequest(
          optionsOrGetApplication.fetch,
          setupRequest as FetchTestRequestSetup,
        );
    }

    const request = supertest(
      optionsOrGetApplication.getApplication(eventStore as Store),
    );
    return async (setupRequest) => (setupRequest as TestRequest)(request);
  };

  return (...givenRequests: (TestRequest | FetchTestRequestSetup)[]) => {
    const executeRequest = resolveRequestExecutor();

    return {
      when: (setupRequest: TestRequest | FetchTestRequestSetup) => {
        const handle = async (): Promise<
          SuperTestResponse | FetchTestResponse
        > => {
          for (const requestFn of givenRequests) {
            await executeRequest(requestFn);
          }

          return executeRequest(setupRequest);
        };

        return {
          then: async (
            verify: ApiE2ESpecificationAssert | [FetchResponseAssert],
          ): Promise<void> => {
            const response = await handle();

            for (const verifyResponse of verify) {
              const assertion = verifyResponse as (
                response: SuperTestResponse | FetchTestResponse,
              ) => boolean | void | Promise<boolean> | Promise<void>;
              const succeeded = await assertion(response);

              if (succeeded === false) assertFails();
            }
          },
        };
      },
    };
  };
}

export const ApiE2ESpecification = {
  for: apiE2ESpecificationFor,
};
