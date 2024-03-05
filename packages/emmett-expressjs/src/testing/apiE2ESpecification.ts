import type { Test } from 'supertest';
import supertest, { type Response } from 'supertest';
import type TestAgent from 'supertest/lib/agent';

import type {
  DefaultStreamVersionType,
  EventStore,
} from '@event-driven-io/emmett';
import assert from 'assert';
import type { Application } from 'express';
import { WrapEventStore } from './utils';

export type E2EResponseAssert = (response: Response) => boolean | void;

export type ApiE2ESpecificationAssert = [E2EResponseAssert];

export type ApiE2ESpecification = (
  ...givenRequests: ((request: TestAgent<supertest.Test>) => Test)[]
) => {
  when: (setupRequest: (request: TestAgent<supertest.Test>) => Test) => {
    then: (verify: ApiE2ESpecificationAssert) => Promise<void>;
  };
};

export const ApiE2ESpecification = {
  for: <StreamVersion = DefaultStreamVersionType>(
    getEventStore: () => EventStore<StreamVersion>,
    getApplication: (eventStore: EventStore<StreamVersion>) => Application,
  ): ApiE2ESpecification => {
    {
      return (
        ...givenRequests: ((request: TestAgent<supertest.Test>) => Test)[]
      ) => {
        const eventStore = WrapEventStore(getEventStore());
        const application = getApplication(eventStore);

        return {
          when: (
            setupRequest: (request: TestAgent<supertest.Test>) => Test,
          ) => {
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
