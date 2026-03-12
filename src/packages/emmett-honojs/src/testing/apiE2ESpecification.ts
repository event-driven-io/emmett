import {
  EmmettError,
  getInMemoryEventStore,
  type EventStore,
  type InMemoryEventStore,
} from '@event-driven-io/emmett';
import assert from 'assert';
import type { Hono } from 'hono';
import {
  HonoTestAgent,
  type HonoResponse,
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

function apiE2ESpecificationFor<
  Store extends EventStore = InMemoryEventStore,
>(options: {
  getEventStore?: () => Store;
  getApplication: (eventStore: Store) => Hono;
}): ApiE2ESpecification;
/** @deprecated Use `ApiE2ESpecification.for({ getEventStore, getApplication })` instead */
function apiE2ESpecificationFor<Store extends EventStore = InMemoryEventStore>(
  getEventStore: () => Store,
  getApplication: (eventStore: Store) => Hono,
): ApiE2ESpecification;
function apiE2ESpecificationFor<Store extends EventStore = InMemoryEventStore>(
  optionsOrGetApplication:
    | (() => Store)
    | {
        getEventStore?: () => Store;
        getApplication: (eventStore: Store) => Hono;
      },
  getApplication?: (eventStore: Store) => Hono,
): ApiE2ESpecification {
  const resolveApplication = (): Hono => {
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
    const testAgent = new HonoTestAgent(application);

    return {
      when: (setupRequest: TestRequest) => {
        const handle = async (): Promise<HonoResponse> => {
          for (const requestFn of givenRequests) {
            const requestResult = requestFn(testAgent);
            if (requestResult instanceof Promise) {
              await requestResult;
            } else {
              await requestResult.execute();
            }
          }

          const requestResult = setupRequest(testAgent);
          if (requestResult instanceof Promise) {
            return requestResult;
          }
          return requestResult.execute();
        };

        return {
          then: async (verify: ApiE2ESpecificationAssert): Promise<void> => {
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

export const ApiE2ESpecification = {
  for: apiE2ESpecificationFor,
};
