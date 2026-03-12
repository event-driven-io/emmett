import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import { EmmettError } from '../errors';
import { getInMemoryEventStore } from '../eventStore';
import {
  assertEqual,
  assertFalse,
  assertMatches,
  assertOk,
  assertThatArray,
} from '../testing';
import type { Event, RecordedMessage } from '../typing';
import { isString } from '../validation';
import { workflowStreamName } from './handleWorkflow';
import {
  workflowOptions,
  type CheckOut,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
  type GuestCheckedOut,
  type InitiateGroupCheckout,
} from './workflow.testHelpers';
import {
  getWorkflowId,
  workflowOutputHandler,
  workflowProcessor,
} from './workflowProcessor';

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

      // Then: process the prefixed input — simulates what the consumer delivers
      // back from the workflow stream. It carries input: true in metadata,
      // which is what the processor uses to dispatch it to the handler.
      const prefixedMessage = {
        type: 'GroupCheckoutWorkflow:InitiateGroupCheckout',
        data: { groupCheckoutId, clerkId: 'clerk-1', guestStayAccountIds, now },
        kind: 'Event',
        metadata: {
          streamName: workflowStreamName({
            workflowName: 'GroupCheckoutWorkflow',
            workflowId: groupCheckoutId,
          }),
          streamPosition: 1n,
          messageId: randomUUID(),
          input: true,
          action: 'InitiatedBy',
        },
      } as unknown as RecordedMessage<InitiateGroupCheckout>;

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

  void describe('router', () => {
    // Simulate what the consumer delivers back from the workflow stream:
    // an output message stamped with action metadata but no input flag.
    // Cast to RecordedMessage<GroupCheckoutInput> to satisfy the processor's
    // public handle() signature — the runtime value is an output type.
    const recordedOutput = <T extends GroupCheckoutOutput>(
      message: T,
      wfStreamName: string,
    ): RecordedMessage<GroupCheckoutInput> =>
      ({
        ...message,
        kind: 'Event',
        metadata: {
          streamName: wfStreamName,
          streamPosition: 2n,
          messageId: randomUUID(),
          action: 'Published',
          // intentionally no `input: true` — this is an output
        },
      }) as unknown as RecordedMessage<GroupCheckoutInput>;

    void it('should call router for output messages (dispatched by metadata, not type name)', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      const groupCheckoutId = randomUUID();
      const streamName = workflowStreamName({
        workflowName: 'GroupCheckoutWorkflow',
        workflowId: groupCheckoutId,
      });

      let routerCalledWith: RecordedMessage<CheckOut> | CheckOut | undefined;

      const processor = workflowProcessor({
        ...workflowOptions,
        outputHandler: workflowOutputHandler<
          GroupCheckoutInput,
          GroupCheckoutOutput,
          CheckOut
        >({
          canHandle: ['CheckOut'],
          handle: (msg) => {
            msg ??= [];
            routerCalledWith = Array.isArray(msg) ? msg[0] : msg;
            return [];
          },
        }),
      });

      const outputMessage = recordedOutput<CheckOut>(
        {
          type: 'CheckOut',
          data: { guestStayAccountId: randomUUID(), groupCheckoutId },
        },
        streamName,
      );

      await processor.start({ connection: { messageStore: eventStore } });
      // TODO: Fix this when combined message metadata doesn't return `now` and other metadata
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      await processor.handle([outputMessage as any], {
        connection: { messageStore: eventStore },
      });

      // Then
      assertOk(routerCalledWith);
      assertEqual(routerCalledWith.type, 'CheckOut');
      // data is fully typed as CheckOut's data — no cast needed
      assertOk(routerCalledWith.data.guestStayAccountId);
    });

    void it('should NOT call router for input-flagged messages even if type is in canHandle', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      const groupCheckoutId = randomUUID();
      const guestStayAccountId = randomUUID();
      const streamName = workflowStreamName({
        workflowName: 'GroupCheckoutWorkflow',
        workflowId: groupCheckoutId,
      });

      let routerCalled = false;

      const processor = workflowProcessor({
        ...workflowOptions,
        outputHandler: {
          // GroupCheckoutFailed is an output type — but we send it as an input
          canHandle: ['GroupCheckoutFailed'],
          handle: () => {
            routerCalled = true;
            return [];
          },
        },
      });

      // Seed the stream so GuestCheckedOut has a workflow state to update
      await eventStore.appendToStream(streamName, [
        {
          type: 'GroupCheckoutWorkflow:InitiateGroupCheckout',
          data: {
            groupCheckoutId,
            clerkId: 'clerk',
            guestStayAccountIds: [guestStayAccountId],
            now: new Date(),
          },
          metadata: {
            input: true,
            originalMessageId: randomUUID(),
            action: 'InitiatedBy',
          },
        },
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId,
            clerkId: 'clerk',
            guestStayAccountIds: [guestStayAccountId],
            initiatedAt: new Date(),
          },
          metadata: { action: 'Published' },
        },
      ] as unknown as Event[]);

      // An input-flagged GuestCheckedOut arriving in the workflow stream
      const inputMessage = {
        type: 'GuestCheckedOut',
        data: { guestStayAccountId, checkedOutAt: new Date(), groupCheckoutId },
        kind: 'Event',
        metadata: {
          streamName,
          streamPosition: 3n,
          messageId: randomUUID(),
          input: true, // ← key: this is an input, not an output
          action: 'Received',
        },
      } as unknown as RecordedMessage<GroupCheckoutInput>;

      await processor.start({ connection: { messageStore: eventStore } });
      // TODO: Fix this when combined message metadata doesn't return `now` and other metadata
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      await processor.handle([inputMessage as any], {
        connection: { messageStore: eventStore },
      });

      // Router must not have been called — metadata.input===true routes to handler
      assertFalse(routerCalled);
    });

    void it('router returning an Input message appends it to the workflow stream', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      const groupCheckoutId = randomUUID();
      const guestStayAccountId = randomUUID();
      const streamName = workflowStreamName({
        workflowName: 'GroupCheckoutWorkflow',
        workflowId: groupCheckoutId,
      });

      const responseEvent: GuestCheckedOut = {
        type: 'GuestCheckedOut',
        data: { guestStayAccountId, checkedOutAt: new Date(), groupCheckoutId },
      };

      const processor = workflowProcessor({
        ...workflowOptions,
        outputHandler: workflowOutputHandler<
          GroupCheckoutInput,
          GroupCheckoutOutput,
          CheckOut
        >({
          canHandle: ['CheckOut'],
          handle: (msg) => {
            const checkout = Array.isArray(msg) ? msg[0]! : msg;
            return {
              ...responseEvent,
              data: {
                ...responseEvent.data,
                guestStayAccountId: checkout.data.guestStayAccountId,
              },
            };
          },
        }),
      });

      const outputMessage = recordedOutput<CheckOut>(
        { type: 'CheckOut', data: { guestStayAccountId, groupCheckoutId } },
        streamName,
      );

      await processor.start({ connection: { messageStore: eventStore } });
      // TODO: Fix this when combined message metadata doesn't return `now` and other metadata
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      await processor.handle([outputMessage as any], {
        connection: { messageStore: eventStore },
      });

      // Then - the response is appended to the workflow stream
      const { events } = await eventStore.readStream(streamName);
      assertThatArray(events).isNotEmpty();
      assertEqual(events[events.length - 1]!.type, 'GuestCheckedOut');
    });

    void it('router returning [] is a no-op', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      const groupCheckoutId = randomUUID();
      const streamName = workflowStreamName({
        workflowName: 'GroupCheckoutWorkflow',
        workflowId: groupCheckoutId,
      });

      const processor = workflowProcessor({
        ...workflowOptions,
        outputHandler: { canHandle: ['CheckOut'], handle: () => [] },
      });

      const outputMessage = recordedOutput<CheckOut>(
        {
          type: 'CheckOut',
          data: { guestStayAccountId: randomUUID(), groupCheckoutId },
        },
        streamName,
      );

      await processor.start({ connection: { messageStore: eventStore } });
      // TODO: Fix this when combined message metadata doesn't return `now` and other metadata
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      await processor.handle([outputMessage as any], {
        connection: { messageStore: eventStore },
      });

      // Stream must not have been created
      assertFalse(await eventStore.streamExists(streamName));
    });

    void it('router returning EmmettError stops processing', async () => {
      // Given
      const eventStore = getInMemoryEventStore();
      const groupCheckoutId = randomUUID();
      const streamName = workflowStreamName({
        workflowName: 'GroupCheckoutWorkflow',
        workflowId: groupCheckoutId,
      });

      const processor = workflowProcessor({
        ...workflowOptions,
        outputHandler: {
          canHandle: ['CheckOut'],
          handle: () => new EmmettError('routing failed'),
        },
      });

      const outputMessage = recordedOutput<CheckOut>(
        {
          type: 'CheckOut',
          data: { guestStayAccountId: randomUUID(), groupCheckoutId },
        },
        streamName,
      );

      await processor.start({ connection: { messageStore: eventStore } });
      // TODO: Fix this when combined message metadata doesn't return `now` and other metadata
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      const result = await processor.handle([outputMessage as any], {
        connection: { messageStore: eventStore },
      });

      assertMatches(result, { type: 'STOP' });
    });

    void it('router response is appended to the workflow stream, derived from getWorkflowId', async () => {
      // Given: the output message's metadata.streamName is intentionally a
      // different value — the processor must derive the target stream from
      // getWorkflowId, not from message.metadata.streamName
      const eventStore = getInMemoryEventStore();
      const groupCheckoutId = randomUUID();
      const guestStayAccountId = randomUUID();
      const correctStream = workflowStreamName({
        workflowName: 'GroupCheckoutWorkflow',
        workflowId: groupCheckoutId,
      });
      const wrongStream = `some-other-stream-${randomUUID()}`;

      const responseEvent: GuestCheckedOut = {
        type: 'GuestCheckedOut',
        data: { guestStayAccountId, checkedOutAt: new Date(), groupCheckoutId },
      };

      const processor = workflowProcessor({
        ...workflowOptions,
        outputHandler: { canHandle: ['CheckOut'], handle: () => responseEvent },
      });

      // Output message carries wrongStream as metadata.streamName
      const outputMessage = recordedOutput<CheckOut>(
        { type: 'CheckOut', data: { guestStayAccountId, groupCheckoutId } },
        wrongStream,
      );

      await processor.start({ connection: { messageStore: eventStore } });
      // TODO: Fix this when combined message metadata doesn't return `now` and other metadata
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      await processor.handle([outputMessage as any], {
        connection: { messageStore: eventStore },
      });

      // Response must land on the workflow stream, not the wrong stream
      const { events } = await eventStore.readStream(correctStream);
      assertThatArray(events).isNotEmpty();
      assertEqual(events[events.length - 1]!.type, 'GuestCheckedOut');

      assertFalse(await eventStore.streamExists(wrongStream));
    });
  });
});
