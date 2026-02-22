import { describe, it } from 'node:test';
import { v7 as uuid } from 'uuid';
import { getInMemoryEventStore } from '../eventStore/inMemoryEventStore';
import { bigIntProcessorCheckpoint } from '../processors';
import { assertDeepEqual, assertEqual } from '../testing';
import type {
  Command,
  Event,
  ReadEventMetadata,
  RecordedMessage,
} from '../typing';
import type { Workflow } from './workflow';
import { workflowProcessor } from './workflowProcessor';

type TestInput = Command<'TestCommand', { id: string }>;
type TestOutput = Command<'TestResult', { value: string }>;
type TestState = Record<string, never>;

const testWorkflow: Workflow<TestInput, TestState, TestOutput> = {
  decide: () => [],
  evolve: (state) => state,
  initialState: () => ({}),
};

type CountInput = Command<'Count', { id: string }>;
type CountOutput = Event<'Counted', { id: string; total: number }>;

const countWorkflow: Workflow<CountInput, { count: number }, CountOutput> = {
  decide: (_input, state) => ({
    type: 'Counted',
    data: { id: _input.data.id, total: state.count + 1 },
  }),
  evolve: (state, event) => {
    if (event.type === 'Counted')
      return { count: (event.data as { total: number }).total };
    return state;
  },
  initialState: () => ({ count: 0 }),
};

const recordedMessage = (
  type: string,
  data: Record<string, unknown>,
  position: bigint = 1n,
): RecordedMessage<
  Command<string, Record<string, unknown>>,
  ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
> => ({
  type,
  data,
  kind: 'Event',
  metadata: {
    streamName: 'source-stream',
    messageId: uuid(),
    checkpoint: bigIntProcessorCheckpoint(position),
    globalPosition: position,
    streamPosition: position,
  },
});

void describe('workflowProcessor', () => {
  void it('stores input in workflow stream', async () => {
    const eventStore = getInMemoryEventStore();

    const processor = workflowProcessor({
      processorId: 'TestWorkflow',
      workflow: testWorkflow,
      getWorkflowId: (msg) => msg.data.id,
      inputs: { commands: ['TestCommand'], events: [] },
      outputs: { commands: ['TestResult'], events: [] },
    });

    await processor.start({ eventStore });

    await processor.handle([recordedMessage('TestCommand', { id: 'wf-1' })], {
      eventStore,
    });

    const result = await eventStore.readStream('workflow-TestWorkflow-wf-1');
    assertEqual(result.events.length, 1);
    assertEqual(result.events[0]!.type, 'TestCommand');
    assertDeepEqual(result.events[0]!.data, { id: 'wf-1' });
  });

  void it('skips storing when workflowId is null', async () => {
    const eventStore = getInMemoryEventStore();

    const processor = workflowProcessor({
      processorId: 'TestWorkflow',
      workflow: testWorkflow,
      getWorkflowId: () => null,
      inputs: { commands: ['TestCommand'], events: [] },
      outputs: { commands: ['TestResult'], events: [] },
    });

    await processor.start({ eventStore });

    await processor.handle([recordedMessage('TestCommand', { id: 'wf-1' })], {
      eventStore,
    });

    const exists = await eventStore.streamExists(
      'workflow-TestWorkflow-wf-1',
    );
    assertEqual(exists, false);
  });

  void it('rebuilds state and calls decide to produce outputs', async () => {
    const eventStore = getInMemoryEventStore();

    const processor = workflowProcessor({
      processorId: 'CountWorkflow',
      workflow: countWorkflow,
      getWorkflowId: (msg) => msg.data.id,
      inputs: { commands: ['Count'], events: [] },
      outputs: { commands: [], events: ['Counted'] },
    });

    await processor.start({ eventStore });

    await processor.handle([recordedMessage('Count', { id: 'wf-1' }, 1n)], {
      eventStore,
    });

    await processor.handle([recordedMessage('Count', { id: 'wf-1' }, 2n)], {
      eventStore,
    });

    const result = await eventStore.readStream('workflow-CountWorkflow-wf-1');
    assertEqual(result.events.length, 4);
    assertEqual(result.events[0]!.type, 'Count');
    assertEqual(result.events[1]!.type, 'Counted');
    assertDeepEqual(result.events[1]!.data, { id: 'wf-1', total: 1 });
    assertEqual(result.events[2]!.type, 'Count');
    assertEqual(result.events[3]!.type, 'Counted');
    assertDeepEqual(result.events[3]!.data, { id: 'wf-1', total: 2 });
  });
});
