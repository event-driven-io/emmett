import type { EventStore } from '@event-driven-io/emmett';
import assert from 'assert';
import type { Hono } from 'hono';
import {
  type HonoResponse,
  HonoTestAgent,
  type TestRequest,
} from './apiSpecification';

export type E2EResponseAssert = (
  response: HonoResponse,
) => boolean | void | Promise<boolean> | Promise<void>;

export type ApiE2ESpecificationAssert = [E2EResponseAssert];

export type ApiE2ESpecification = (...givenRequests: TestRequest[]) => {
  when: (setupRequest: TestRequest) => {
    then: (verify: ApiE2ESpecificationAssert) => Promise<void>;
  };
};

export const ApiE2ESpecification = {
  for: <Store extends EventStore = EventStore>(
    getEventStore: () => Store,
    getApplication: (eventStore: Store) => Hono,
  ): ApiE2ESpecification => {
    {
      return (...givenRequests: TestRequest[]) => {
        const eventStore = getEventStore();
        const application = getApplication(eventStore);
        const testAgent = new HonoTestAgent(application);

        return {
          when: (setupRequest: TestRequest) => {
            const handle = async (): Promise<HonoResponse> => {
              for (const requestFn of givenRequests) {
                const requestResult = requestFn(testAgent);
                // If it's already a promise (HonoResponse), await it
                if (requestResult instanceof Promise) {
                  await requestResult;
                } else {
                  // Otherwise, it's a HonoTestRequest, execute it
                  await requestResult.execute();
                }
              }

              const requestResult = setupRequest(testAgent);
              // If it's already a promise (HonoResponse), return it
              if (requestResult instanceof Promise) {
                return requestResult;
              }
              // Otherwise, it's a HonoTestRequest, execute it
              return requestResult.execute();
            };

            return {
              then: async (
                verify: ApiE2ESpecificationAssert,
              ): Promise<void> => {
                const response = await handle();

                for (const assertion of verify) {
                  const succeeded = await assertion(response);

                  if (succeeded === false) assert.fail();
                }
              },
            };
          },
        };
      };
    }
  },
};
