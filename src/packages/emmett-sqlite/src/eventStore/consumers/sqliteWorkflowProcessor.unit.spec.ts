import {
  assertEqual,
  assertMatches,
  getInMemoryEventStore,
  type Command,
  type Event,
  type Workflow,
} from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import { sqliteWorkflowProcessor } from './sqliteWorkflowProcessor';

type TestInput = Command<'TestCommand', { id: string }>;
type TestOutput = Event<'TestResult', { id: string }>;

const testWorkflow: Workflow<TestInput, Record<string, never>, TestOutput> = {
  decide: () => [],
  evolve: (state) => state,
  initialState: () => ({}),
};

void describe('sqliteWorkflowProcessor', () => {
  void it('creates processor with correct id and type', () => {
    const eventStore = getInMemoryEventStore();

    const processor = sqliteWorkflowProcessor({
      processorId: 'TestSQLiteWorkflow',
      workflow: testWorkflow,
      getWorkflowId: (msg) => msg.data.id,
      inputs: { commands: ['TestCommand'], events: [] },
      outputs: { commands: [], events: ['TestResult'] },
      eventStore,
    });

    assertMatches(processor, {
      id: 'TestSQLiteWorkflow',
      type: 'reactor',
    });
    assertEqual(typeof processor.handle, 'function');
    assertEqual(typeof processor.start, 'function');
    assertEqual(typeof processor.close, 'function');
  });
});
