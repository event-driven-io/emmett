import { dumbo, dumboDatabaseDriverRegistry } from '@event-driven-io/dumbo';
import '@event-driven-io/dumbo/sqlite3';
import {
  assertEqual,
  assertIsNotNull,
  assertThrows,
  assertTrue,
} from '@event-driven-io/emmett';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { clearRegisteredDumboDrivers } from './dumboDriverIsolation';

const connectionString = 'file::memory:';

void describe('clearRegisteredDumboDrivers', () => {
  let restore: () => void;

  beforeEach(() => {
    restore = clearRegisteredDumboDrivers();
  });

  afterEach(() => {
    restore();
  });

  void it('leaves the driver registry unable to resolve anything', () => {
    assertEqual(null, dumboDatabaseDriverRegistry.tryGet({ connectionString }));

    // eslint-disable-next-line no-restricted-syntax
    const error = assertThrows<Error>(() => dumbo({ connectionString }));

    assertTrue(error.message.includes('No plugin found for driver type'));
  });

  void it('resolves drivers again once restored', async () => {
    restore();

    assertIsNotNull(dumboDatabaseDriverRegistry.tryGet({ connectionString }));

    // eslint-disable-next-line no-restricted-syntax
    const pool = dumbo({ connectionString });
    await pool.close();
  });
});
