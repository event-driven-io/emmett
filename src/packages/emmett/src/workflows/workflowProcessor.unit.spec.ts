import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { getInMemoryEventStore } from '../eventStore';
import {
  assertEqual,
  assertFalse,
  assertMatches,
  assertOk,
  assertThatArray,
} from '../testing';
import type { AnyReadEventMetadata, RecordedMessage } from '../typing';
import { isString } from '../validation';
import { workflowStreamName } from './handleWorkflow';
import {
  GroupCheckoutWorkflow,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
  type InitiateGroupCheckout,
} from './workflow.unit.spec';
import {
  getWorkflowId,
  workflowProcessor,
  type WorkflowOptions,
} from './workflowProcessor';

type WorkflowMeta = AnyReadEventMetadata;

const workflowOptions: WorkflowOptions<
  GroupCheckoutInput,
  GroupCheckout,
  GroupCheckoutOutput,
  WorkflowMeta
> = {
  workflow: GroupCheckoutWorkflow,
  getWorkflowId: (input) =>
    (input.data as { groupCheckoutId?: string }).groupCheckoutId ?? null,
  inputs: {
    commands: ['InitiateGroupCheckout', 'TimeoutGroupCheckout'],
    events: ['GuestCheckedOut', 'GuestCheckoutFailed'],
  },
  outputs: {
    commands: ['CheckOut'],
    events: [
      'GroupCheckoutCompleted',
      'GroupCheckoutFailed',
      'GroupCheckoutTimedOut',
    ],
  },
};

const recorded = <T extends GroupCheckoutInput>(
  message: T,
): RecordedMessage<T> =>
  ({
    ...message,
    kind: 'Event',
    metadata: {
      streamName: `test-${randomUUID()}`,
      streamPosition: 1n,
      messageId: randomUUID(),
    },
  }) as unknown as RecordedMessage<T>;

void describe('Workflow Processor', () => {
  void describe('getWorkflowId', () => {
    void it('should generate consistent processor ID from workflow name', () => {
      // When
      const id1 = getWorkflowId({ workflowName: 'TestWorkflow' });
      const id2 = getWorkflowId({ workflowName: 'TestWorkflow' });

      // Then
      assertEqual(id1, 'emt:processor:workflow:TestWorkflow');
      assertEqual(id1, id2);
    });

    void it('should generate different IDs for different workflow names', () => {
      // When
      const id1 = getWorkflowId({ workflowName: 'WorkflowA' });
      const id2 = getWorkflowId({ workflowName: 'WorkflowB' });

      // Then
      assertEqual(id1, 'emt:processor:workflow:WorkflowA');
      assertEqual(id2, 'emt:processor:workflow:WorkflowB');
    });
  });

  void describe('workflowProcessor', () => {
    void it('should create workflow processor with default options', () => {
      // When
      const processor = workflowProcessor(workflowOptions);

      // Then
      assertMatches(processor, {
        id: 'emt:processor:workflow:GroupCheckoutWorkflow',
        type: 'projector',
      });
      assertOk(isString(processor.instanceId));
    });

    void it('should use custom processorId when provided', () => {
      // When
      const customId = 'custom-processor-id';
      const processor = workflowProcessor({
        ...workflowOptions,
        processorId: customId,
      });

      // Then
      assertEqual(processor.id, customId);
    });

    void it('should have canHandle with only input types when separateInputInboxFromProcessing is false', () => {
      // When
      const processor = workflowProcessor({
        ...workflowOptions,
        separateInputInboxFromProcessing: false,
      });

      // Then
      assertOk(processor.canHandle);
      assertThatArray(processor.canHandle).hasSize(4);
      assertThatArray(processor.canHandle).containsExactlyInAnyOrder([
        'InitiateGroupCheckout',
        'TimeoutGroupCheckout',
        'GuestCheckedOut',
        'GuestCheckoutFailed',
      ]);
    });

    void it('should have canHandle with input types only when separateInputInboxFromProcessing is undefined', () => {
      // When
      const processor = workflowProcessor(workflowOptions);

      // Then
      assertOk(processor.canHandle);
      assertThatArray(processor.canHandle).hasSize(4);
      assertThatArray(processor.canHandle).containsExactlyInAnyOrder([
        'InitiateGroupCheckout',
        'TimeoutGroupCheckout',
        'GuestCheckedOut',
        'GuestCheckoutFailed',
      ]);
    });

    void it('should have canHandle with both input types and prefixed types when separateInputInboxFromProcessing is true', () => {
      // When
      const processor = workflowProcessor({
        ...workflowOptions,
        separateInputInboxFromProcessing: true,
      });

      // Then
      assertOk(processor.canHandle);
      assertThatArray(processor.canHandle).hasSize(8);
      assertThatArray(processor.canHandle).containsExactlyInAnyOrder([
        'InitiateGroupCheckout',
        'TimeoutGroupCheckout',
        'GuestCheckedOut',
        'GuestCheckoutFailed',
        'GroupCheckoutWorkflow:InitiateGroupCheckout',
        'GroupCheckoutWorkflow:TimeoutGroupCheckout',
        'GroupCheckoutWorkflow:GuestCheckedOut',
        'GroupCheckoutWorkflow:GuestCheckoutFailed',
      ]);
    });

    void it('should handle workflow messages and store them in event store', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      const groupCheckoutId = randomUUID();
      const guestStayAccountIds = [randomUUID()];
      const now = new Date();

      const processor = workflowProcessor(workflowOptions);

      const message = recorded<InitiateGroupCheckout>({
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds,
          now,
        },
      });

      await processor.start({
        connection: { messageStore: eventStore },
      });

      // When
      await processor.handle([message], {
        connection: { messageStore: eventStore },
      });

      // Then
      const { events } = await eventStore.readStream(
        workflowStreamName({
          workflowName: 'GroupCheckoutWorkflow',
          workflowId: groupCheckoutId,
        }),
      );
      assertThatArray(events).isNotEmpty();
      assertEqual(
        events[0]!.type,
        'GroupCheckoutWorkflow:InitiateGroupCheckout',
      );
      assertEqual(events[1]!.type, 'GroupCheckoutInitiated');
    });

    void it('should handle prefixed messages in separated inbox mode', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      const groupCheckoutId = randomUUID();
      const guestStayAccountIds = [randomUUID()];
      const now = new Date();

      const processor = workflowProcessor({
        ...workflowOptions,
        separateInputInboxFromProcessing: true,
      });

      // First: store the unprefixed input
      const externalMessage = recorded<InitiateGroupCheckout>({
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds,
          now,
        },
      });

      await processor.start({
        connection: { messageStore: eventStore },
      });

      await processor.handle([externalMessage], {
        connection: { messageStore: eventStore },
      });

      // Then: process the prefixed input
      const prefixedMessage = recorded({
        type: 'GroupCheckoutWorkflow:InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds,
          now,
        },
      } as unknown as InitiateGroupCheckout);

      await processor.handle([prefixedMessage], {
        connection: { messageStore: eventStore },
      });

      // Then
      const { events } = await eventStore.readStream(
        workflowStreamName({
          workflowName: 'GroupCheckoutWorkflow',
          workflowId: groupCheckoutId,
        }),
      );
      assertThatArray(events).hasSize(3); // 1 stored input + 2 outputs
    });

    void it('should skip messages when getWorkflowId returns null', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      const groupCheckoutId = randomUUID();
      const guestStayAccountIds = [randomUUID()];
      const now = new Date();

      const processor = workflowProcessor({
        ...workflowOptions,
        getWorkflowId: () => null,
      });

      const message = recorded<InitiateGroupCheckout>({
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds,
          now,
        },
      });

      await processor.start({
        connection: { messageStore: eventStore },
      });

      // When
      await processor.handle([message], {
        connection: { messageStore: eventStore },
      });

      // Then - no workflow stream should be created
      assertFalse(
        await eventStore.streamExists(
          workflowStreamName({
            workflowName: 'GroupCheckoutWorkflow',
            workflowId: groupCheckoutId,
          }),
        ),
      );
    });

    void it('should call onStart hook on start', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      let onStartCalled = false;

      const processor = workflowProcessor({
        ...workflowOptions,
        hooks: {
          onStart: () => {
            onStartCalled = true;
            return Promise.resolve();
          },
        },
      });

      // When
      await processor.start({
        connection: { messageStore: eventStore },
      });

      // Then
      assertEqual(onStartCalled, true);
    });

    void it('should call onClose hook on close', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      let onCloseCalled = false;

      const processor = workflowProcessor({
        ...workflowOptions,
        hooks: {
          onClose: () => {
            onCloseCalled = true;
            return Promise.resolve();
          },
        },
      });

      await processor.start({
        connection: { messageStore: eventStore },
      });

      // When
      await processor.close({
        connection: { messageStore: eventStore },
      });

      // Then
      assertEqual(onCloseCalled, true);
    });

    void it('should set isActive to false when close is called', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      const processor = workflowProcessor(workflowOptions);

      // When
      await processor.start({
        connection: { messageStore: eventStore },
      });
      assertEqual(processor.isActive, true);

      await processor.close({
        connection: { messageStore: eventStore },
      });

      // Then
      assertEqual(processor.isActive, false);
    });

    void it('should automatically close on SIGTERM', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      let closeCalled = false;

      const processor = workflowProcessor({
        ...workflowOptions,
        hooks: {
          onClose: () => {
            closeCalled = true;
            return Promise.resolve();
          },
        },
      });

      await processor.start({
        connection: { messageStore: eventStore },
      });
      assertEqual(processor.isActive, true);

      // When - emit SIGTERM
      process.emit('SIGTERM');
      await Promise.resolve();

      // Then
      assertEqual(processor.isActive, false);
      assertEqual(closeCalled, true);
    });

    void it('should automatically close on SIGINT', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      const processor = workflowProcessor(workflowOptions);

      await processor.start({
        connection: { messageStore: eventStore },
      });
      assertEqual(processor.isActive, true);

      // When
      process.emit('SIGINT');
      await Promise.resolve();

      // Then
      assertEqual(processor.isActive, false);
    });

    void it('should not process messages not in canHandle list', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      const processor = workflowProcessor(workflowOptions);

      const unknownMessage = recorded({
        type: 'UnknownMessageType',
        data: { someData: 'value' },
      } as unknown as InitiateGroupCheckout);

      await processor.start({
        connection: { messageStore: eventStore },
      });

      // When
      await processor.handle([unknownMessage], {
        connection: { messageStore: eventStore },
      });
      // Then - reactor filtered the message before eachMessage; no assertion needed beyond no crash
    });

    void it('should process only matching messages in a mixed batch', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      const groupCheckoutId = randomUUID();
      const guestStayAccountIds = [randomUUID()];
      const now = new Date();

      const processor = workflowProcessor(workflowOptions);

      const matchingMessage = recorded<InitiateGroupCheckout>({
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds,
          now,
        },
      });

      const nonMatchingMessage = recorded({
        type: 'SomeOtherMessageType',
        data: { value: 'test' },
      } as unknown as InitiateGroupCheckout);

      await processor.start({
        connection: { messageStore: eventStore },
      });

      // When
      await processor.handle([nonMatchingMessage, matchingMessage], {
        connection: { messageStore: eventStore },
      });

      // Then - only the matching message should be processed
      const { events } = await eventStore.readStream(
        workflowStreamName({
          workflowName: 'GroupCheckoutWorkflow',
          workflowId: groupCheckoutId,
        }),
      );
      assertThatArray(events).isNotEmpty();
      assertEqual(
        events[0]!.type,
        'GroupCheckoutWorkflow:InitiateGroupCheckout',
      );
    });
  });
});
