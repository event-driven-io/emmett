import supertest, { type Response } from 'supertest';

import {
  EmmettError,
  getInMemoryEventStore,
  type EventStore,
  type InMemoryEventStore,
} from '@event-driven-io/emmett';
import assert from 'assert';
import type { Application } from 'express';
import type { TestRequest } from './apiSpecification';

export type E2EResponseAssert = (response: Response) => boolean | void;

export type ApiE2ESpecificationAssert = [E2EResponseAssert];

export type ApiE2ESpecification = (...givenRequests: TestRequest[]) => {
  when: (setupRequest: TestRequest) => {
    then: (verify: ApiE2ESpecificationAssert) => Promise<void>;
  };
};

function apiE2ESpecificationFor<
  Store extends EventStore = InMemoryEventStore,
>(options: {
  getEventStore?: () => Store;
  getApplication: (eventStore: Store) => Application;
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
        getApplication: (eventStore: Store) => Application;
      },
  getApplication?: (eventStore: Store) => Application,
): ApiE2ESpecification {
  const resolveApplication = (): Application => {
    if (typeof optionsOrGetApplication === 'function' && getApplication) {
      const eventStore = optionsOrGetApplication();
      return getApplication(eventStore);
    }

    if (typeof optionsOrGetApplication !== 'object') {
      throw new EmmettError(
        'Invalid arguments provided to apiE2ESpecificationFor. Expected either an options object or a getEventStore function and getApplication function.',
      );
    }

    const eventStore =
      optionsOrGetApplication.getEventStore?.() ?? getInMemoryEventStore();
    return optionsOrGetApplication.getApplication(eventStore as Store);
  };

  return (...givenRequests: TestRequest[]) => {
    const application = resolveApplication();

    return {
      when: (setupRequest: TestRequest) => {
        const handle = async () => {
          for (const requestFn of givenRequests) {
            await requestFn(supertest(application));
          }

          return setupRequest(supertest(application));
        };

        return {
          then: async (verify: ApiE2ESpecificationAssert): Promise<void> => {
            const response = await handle();

            verify.forEach((assertion) => {
              const succeeded = assertion(response);

              if (succeeded === false) assert.fail();
            });
          },
        };
      },
    };
  };
}

export const ApiE2ESpecification = {
  for: apiE2ESpecificationFor,
};
