import {
  assertDoesNotThrow,
  assertEqual,
  assertOk,
  assertThrows,
  EmmettError,
  type ProjectionRegistration,
} from '@event-driven-io/emmett';
import { MongoParseError } from 'mongodb';
import { describe, it } from 'node:test';
import {
  getMongoDBEventStore,
  type MongoDBReadEventMetadata,
} from './mongoDBEventStore';
import type { MongoDBProjectionInlineHandlerContext } from './projections';

const createProjectionRegistration = (
  name?: string,
): ProjectionRegistration<
  'inline',
  MongoDBReadEventMetadata,
  MongoDBProjectionInlineHandlerContext
> => ({
  type: 'inline',
  projection: {
    name,
    canHandle: ['test'],
    handle: () => Promise.resolve(),
  },
});

void describe('getMongoDBEventStore', () => {
  const connectionString = 'mongodb://dummy';

  void it('should create a store successfully for setup with a connection string', () => {
    assertDoesNotThrow(() => {
      const store = getMongoDBEventStore({
        connectionString,
        // no projections
      });

      assertOk(store);
    });
  });

  void it('should not create a store successfully for wribg connection string format', () => {
    assertThrows<MongoParseError>(() =>
      getMongoDBEventStore({
        connectionString: 'definitely not a valid connection string',
        // no projections
      }),
    );
  });

  void describe('Setting Projections', () => {
    void it('should create a store if inline projections exist (no duplicates)', () => {
      const thrownError = assertDoesNotThrow(() => {
        const store = getMongoDBEventStore({
          connectionString,
          projections: [
            createProjectionRegistration('proj1'),
            createProjectionRegistration('proj3'),
          ],
        });
        assertOk(store);
      });
      assertEqual(
        thrownError,
        null,
        'Expected no error when valid inline projections',
      );
    });

    void it('should throw if there are duplicate inline projection names', () => {
      assertThrows(
        () =>
          getMongoDBEventStore({
            connectionString,
            projections: [
              createProjectionRegistration('dupName'),
              createProjectionRegistration('dupName'),
            ],
          }),
        (err) =>
          err instanceof EmmettError &&
          /You cannot register multiple projections with the same name/i.test(
            err.message,
          ),
      );
    });

    void it('should throw if inline projections repeat with an empty string name', () => {
      assertThrows<EmmettError>(() =>
        getMongoDBEventStore({
          connectionString,
          projections: [
            createProjectionRegistration(''),
            createProjectionRegistration(''),
          ],
        }),
      );
    });

    void it('should not throw if there is only one inline projection with empty name', () => {
      assertDoesNotThrow(() => {
        const store = getMongoDBEventStore({
          connectionString,
          projections: [createProjectionRegistration('')],
        });
        assertOk(store);
      });
    });

    void it('should not throw if there is only one inline projection with undefined name', () => {
      assertDoesNotThrow(() => {
        const store = getMongoDBEventStore({
          connectionString,
          projections: [
            createProjectionRegistration('inline'), // name is undefined
          ],
        });
        assertOk(store);
      });
    });

    void it('should throw if multiple inline projections have undefined name', () => {
      assertThrows<EmmettError>(() =>
        getMongoDBEventStore({
          connectionString,
          projections: [
            createProjectionRegistration('inline'), // undefined
            createProjectionRegistration('inline'), // undefined
          ],
        }),
      );
    });

    void it('should allow mixing empty string and undefined names among inline projections', () => {
      assertDoesNotThrow(() => {
        const store = getMongoDBEventStore({
          connectionString,
          projections: [
            createProjectionRegistration(''),
            createProjectionRegistration(undefined),
          ],
        });
        assertOk(store);
      });
    });
  });
});
