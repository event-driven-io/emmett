import { dumboDatabaseDriverRegistry } from '@event-driven-io/dumbo';

/**
 * A connection string no driver can claim. The global registry resolves a
 * driver either from an explicit `driverType` or by parsing the connection
 * string; an unparseable one leaves it with nothing to match. A `dumbo()` call
 * that still succeeds on these options was therefore handed its driver.
 */
export const unresolvableConnectionString = 'driver-must-come-from-options';

type MutableRegistry = {
  tryGet: (typeof dumboDatabaseDriverRegistry)['tryGet'];
  tryResolve: (typeof dumboDatabaseDriverRegistry)['tryResolve'];
};

/**
 * Runs `handle` with the global dumbo driver registry resolving nothing.
 *
 * The registry exposes no `clear`, and `dumbo()` reads it through the imported
 * module binding rather than through `globalThis`, so replacing the global slot
 * goes unnoticed. Overriding the lookup on the shared object is the only
 * observable way to empty it. That makes this global for the duration of the
 * call, so it belongs in a spec file of its own.
 */
export const withoutRegisteredDumboDrivers = async <Result>(
  handle: () => Promise<Result>,
): Promise<Result> => {
  const registry = dumboDatabaseDriverRegistry as MutableRegistry;
  const { tryGet, tryResolve } = registry;

  registry.tryGet = () => null;
  registry.tryResolve = () => Promise.resolve(null);

  try {
    return await handle();
  } finally {
    registry.tryGet = tryGet;
    registry.tryResolve = tryResolve;
  }
};
