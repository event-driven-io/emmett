import { describe, it } from 'node:test';
import {
  filterProjections,
  type ProjectionHandlingType,
  type ProjectionRegistration,
} from '.';
import { EmmettError } from '../errors';
import {
  assertDeepEqual,
  assertDoesNotThrow,
  assertEqual,
  assertThatArray,
  assertThrows,
} from '../testing';

const createProjectionRegistration = <T extends ProjectionHandlingType>(
  type: T,
  name?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ProjectionRegistration<T, any, any> => ({
  type,
  projection: {
    name,
    canHandle: ['test'],
    handle: () => Promise.resolve(),
  },
});

void describe('filterProjections', () => {
  void it('should return an empty array if there are no projections', () => {
    const result = filterProjections('inline', []);

    assertThatArray(result).isEmpty();
  });

  void it('should return an empty array if no projections match the given type', () => {
    const registrations = [
      createProjectionRegistration('async', 'proj1'),
      createProjectionRegistration('async', 'proj2'),
    ];
    const result = filterProjections('inline', registrations);
    assertThatArray(result).isEmpty();
  });

  void it('should return projections of the requested type', () => {
    const registrations = [
      createProjectionRegistration('inline', 'projA'),
      createProjectionRegistration('async', 'projB'),
      createProjectionRegistration('inline', 'projC'),
    ];
    const result = filterProjections('inline', registrations);

    const names = result.map((r) => r.name);

    names.sort();
    assertDeepEqual(names, ['projA', 'projC']);
  });

  void it('should throw an EmmettError if it detects duplicate names', () => {
    const registrations = [
      createProjectionRegistration('inline', 'duplicateName'),
      createProjectionRegistration('inline', 'duplicateName'),
    ];

    assertThrows(
      () => filterProjections('inline', registrations),
      (error) =>
        error instanceof EmmettError &&
        /You cannot register multiple projections with the same name/.test(
          error.message,
        ),
    );
  });

  void it('should not throw if there are duplicates in a different type', () => {
    // Only 'inline' type is filtered => it should ignore duplicates in 'async'
    const registrations = [
      createProjectionRegistration('async', 'dupe'),
      createProjectionRegistration('async', 'dupe'),
      createProjectionRegistration('inline', 'uniqueName'),
    ];

    assertDoesNotThrow(() => {
      const result = filterProjections('inline', registrations);
      assertThatArray(result.map((p) => p.name)).containsExactly('uniqueName');
    });
  });

  void it('should throw if name is empty string but repeated', () => {
    const registrations = [
      createProjectionRegistration('inline', ''),
      createProjectionRegistration('inline', ''),
    ];

    assertThrows<EmmettError>(() => filterProjections('inline', registrations));
  });

  void it('should not throw if there is only one empty-name projection', () => {
    const registrations = [
      createProjectionRegistration('inline', ''),
      createProjectionRegistration('async', ''),
    ];

    assertDoesNotThrow(() => {
      const result = filterProjections('inline', registrations);
      // Only one inline => no duplicates
      assertEqual(result.length, 1, 'Expected exactly 1 projection');
      assertEqual(result[0]!.name, '', 'Expected the name to be empty string');
    });
  });

  void it('should not throw if there is one projection with undefined name', () => {
    const registrations = [
      createProjectionRegistration('inline'),
      createProjectionRegistration('async', 'someName'),
    ];

    assertDoesNotThrow(() => {
      const result = filterProjections('inline', registrations);
      assertEqual(result.length, 1, 'Expected only 1 "inline" projection');
      assertEqual(
        result[0]!.name,
        undefined,
        'Expected the name to be undefined',
      );
    });
  });

  void it('should throw if multiple projections have undefined name', () => {
    const registrations = [
      createProjectionRegistration('inline'),
      createProjectionRegistration('inline'),
    ];

    assertThrows<EmmettError>(() => filterProjections('inline', registrations));
  });

  void it('should allow mixing empty string and undefined (not duplicates)', () => {
    const registrations = [
      createProjectionRegistration('inline', ''),
      createProjectionRegistration('inline', undefined),
    ];

    assertDoesNotThrow(() => {
      const result = filterProjections('inline', registrations);
      // Expect both, since '' != undefined
      assertThatArray(result).hasSize(2);
    });
  });
});
