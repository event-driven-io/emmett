import {
  EmmettError,
  assertFails,
  getInMemoryEventStore,
  type EventStore,
  type InMemoryEventStore,
} from '@event-driven-io/emmett';
import {
  HonoTestAgent,
  type HonoResponse,
  type TestRequest,
} from './apiSpecification';

type FetchApplication = {
  fetch(request: Request): Response | Promise<Response>;
};

type Fetch = (request: Request) => Response | Promise<Response>;

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
  fetch: Fetch;
  getApplication?: never;
}): ApiE2ESpecification;
function apiE2ESpecificationFor<
  Store extends EventStore = InMemoryEventStore,
>(options: {
  getEventStore?: () => Store;
  getApplication: (eventStore: Store) => FetchApplication;
  fetch?: never;
}): ApiE2ESpecification;
/** @deprecated Use `ApiE2ESpecification.for({ getEventStore, getApplication })` instead */
function apiE2ESpecificationFor<Store extends EventStore = InMemoryEventStore>(
  getEventStore: () => Store,
  getApplication: (eventStore: Store) => FetchApplication,
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
        getApplication: (eventStore: Store) => FetchApplication;
        fetch?: never;
      },
  getApplication?: (eventStore: Store) => FetchApplication,
): ApiE2ESpecification {
  const resolveFetch = (): Fetch => {
    if (typeof optionsOrGetApplication === 'function' && getApplication) {
      const eventStore = optionsOrGetApplication();
      const application = getApplication(eventStore);
      return (request) => application.fetch(request);
    }

    if (typeof optionsOrGetApplication !== 'object') {
      throw new EmmettError(
        'Invalid arguments provided to apiE2ESpecificationFor. Expected either an options object or a getEventStore function and getApplication function.',
      );
    }

    const eventStore =
      optionsOrGetApplication.getEventStore?.() ?? getInMemoryEventStore();
    if (optionsOrGetApplication.fetch !== undefined) {
      return optionsOrGetApplication.fetch;
    }

    const application = optionsOrGetApplication.getApplication(
      eventStore as Store,
    );
    return (request) => application.fetch(request);
  };

  return (...givenRequests: TestRequest[]) => {
    const fetch = resolveFetch();
    const testAgent = new HonoTestAgent({ fetch });

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
