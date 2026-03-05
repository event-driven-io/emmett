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

export const ApiE2ESpecification = {
  for: <Store extends EventStore = InMemoryEventStore>(options: {
    getEventStore?: () => Store;
    getApplication: (eventStore: Store) => Application;
  }): ApiE2ESpecification => {
    {
      return (...givenRequests: TestRequest[]) => {
        const eventStore = options.getEventStore?.() ?? getInMemoryEventStore();
        const application = options.getApplication(eventStore as Store);

        return {
          when: (setupRequest: TestRequest) => {
            const handle = async () => {
              for (const requestFn of givenRequests) {
                await requestFn(supertest(application));
              }

              return setupRequest(supertest(application));
            };

            return {
              then: async (
                verify: ApiE2ESpecificationAssert,
              ): Promise<void> => {
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
  },
};
