import { describe, expectTypeOf, it } from 'vitest';
import { projection } from '../projections';
import { assertEqual } from '../testing';
import type { Event } from '../typing';
import { workflowProcessor } from '../workflows';
import { workflowOptions } from '../workflows/workflow.testHelpers';
import { projector, reactor, resolveAutoMigration } from './processors';

type TestEvent = Event<'test', { counter: number }>;

type TestSchema = { schemaComponentKey: string };

const projectionSchema: TestSchema = { schemaComponentKey: 'projection' };
const processorSchema: TestSchema = { schemaComponentKey: 'processor' };

const testProjection = projection<TestEvent>({
  name: 'test',
  canHandle: ['test'],
  handle: () => Promise.resolve(),
});

void describe('Processor schema', () => {
  void it('exposes the schema of a reactor', () => {
    const processor = reactor({
      processorId: 'reactor',
      eachMessage: () => Promise.resolve(),
      schema: processorSchema,
    });

    assertEqual(processor.schema, processorSchema);
    expectTypeOf(processor.schema).toEqualTypeOf<TestSchema | undefined>();
  });

  void it('exposes no schema when a reactor sets none', () => {
    const processor = reactor<TestEvent>({
      processorId: 'reactor',
      eachMessage: () => Promise.resolve(),
    });

    assertEqual(processor.schema, undefined);
  });

  void it('exposes the schema of a projector', () => {
    const processor = projector({
      projection: testProjection,
      schema: processorSchema,
    });

    assertEqual(processor.schema, processorSchema);
  });

  void it("exposes the projection's schema when a projector sets none", () => {
    const processor = projector({
      projection: projection({
        name: 'test',
        canHandle: ['test'],
        handle: () => Promise.resolve(),
        schema: projectionSchema,
      }),
    });

    assertEqual(processor.schema, projectionSchema);
    expectTypeOf(processor.schema).toEqualTypeOf<TestSchema | undefined>();
  });

  void it("prefers the projector's schema over its projection's", () => {
    const processor = projector({
      projection: projection<TestEvent>({
        name: 'test',
        canHandle: ['test'],
        handle: () => Promise.resolve(),
        schema: projectionSchema,
      }),
      schema: processorSchema,
    });

    assertEqual(processor.schema, processorSchema);
  });

  void it('exposes the schema of a workflow processor', () => {
    const processor = workflowProcessor({
      ...workflowOptions,
      schema: processorSchema,
    });

    assertEqual(processor.schema, processorSchema);
    expectTypeOf(processor.schema).toEqualTypeOf<TestSchema | undefined>();
  });

  void it('accepts autoMigration on every processor', () => {
    const processors = [
      reactor<TestEvent>({
        processorId: 'reactor',
        eachMessage: () => Promise.resolve(),
        autoMigration: 'None',
      }),
      projector({ projection: testProjection, autoMigration: 'None' }),
      workflowProcessor({ ...workflowOptions, autoMigration: 'None' }),
    ];

    assertEqual(processors.length, 3);
  });

  void it('accepts EnsureMigrated on every processor', () => {
    const processors = [
      reactor<TestEvent>({
        processorId: 'reactor',
        eachMessage: () => Promise.resolve(),
        autoMigration: 'EnsureMigrated',
      }),
      projector({
        projection: testProjection,
        autoMigration: 'EnsureMigrated',
      }),
      workflowProcessor({
        ...workflowOptions,
        autoMigration: 'EnsureMigrated',
      }),
    ];

    assertEqual(processors.length, 3);
  });
});

void describe('resolveAutoMigration', () => {
  void it('uses the own value', () => {
    assertEqual(resolveAutoMigration('None', 'CreateOrUpdate'), 'None');
    assertEqual(
      resolveAutoMigration('CreateOrUpdate', 'None'),
      'CreateOrUpdate',
    );
  });

  void it('inherits the value when the own value is not set', () => {
    assertEqual(resolveAutoMigration(undefined, 'None'), 'None');
  });

  void it('keeps an own or inherited EnsureMigrated', () => {
    assertEqual(
      resolveAutoMigration('EnsureMigrated', 'CreateOrUpdate'),
      'EnsureMigrated',
    );
    assertEqual(
      resolveAutoMigration(undefined, 'EnsureMigrated'),
      'EnsureMigrated',
    );
  });

  void it('defaults to CreateOrUpdate when no value is set', () => {
    assertEqual(resolveAutoMigration(undefined, undefined), 'CreateOrUpdate');
  });
});
