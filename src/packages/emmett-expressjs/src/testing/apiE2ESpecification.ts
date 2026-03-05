import supertest, { type Response } from 'supertest';

import {
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

function apiE2ESpecificationFor(
  getApplication: () => Application,
): ApiE2ESpecification;
/** @deprecated Use `ApiE2ESpecification.for(() => getApplication(...))` instead */
function apiE2ESpecificationFor<
  Store extends EventStore = InMemoryEventStore,
>(options: {
  getEventStore?: () => Store;
  getApplication: (eventStore: Store) => Application;
}): ApiE2ESpecification;
function apiE2ESpecificationFor<Store extends EventStore = InMemoryEventStore>(
  optionsOrGetApplication:
    | (() => Application)
    | {
        getEventStore?: () => Store;
        getApplication: (eventStore: Store) => Application;
      },
): ApiE2ESpecification {
  const resolveApplication = (): Application => {
    if (typeof optionsOrGetApplication === 'function') {
      return optionsOrGetApplication();
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
