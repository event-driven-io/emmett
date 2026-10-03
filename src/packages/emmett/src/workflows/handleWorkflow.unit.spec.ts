import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getInMemoryEventStore } from '../eventStore';
import type { RecordedMessage } from '../typing';
import { WorkflowHandler, workflowStreamName } from './handleWorkflow';
import {
  workflowOptions,
  type GroupCheckoutInput,
  type InitiateGroupCheckout,
} from './workflow.testHelpers';

const now = new Date('2026-01-01T10:00:00Z');

const delivered = <T extends GroupCheckoutInput>(
  message: T,
  messageId: string,
): RecordedMessage<T> =>
  ({
    ...message,
    metadata: { messageId },
  }) as unknown as RecordedMessage<T>;

const initiateGroupCheckout = (
  groupCheckoutId: string,
  guestStayAccountIds = ['guest-stay-1', 'guest-stay-2'],
): InitiateGroupCheckout => ({
  type: 'InitiateGroupCheckout',
  data: { groupCheckoutId, clerkId: 'clerk-1', guestStayAccountIds, now },
});

const streamOf = (groupCheckoutId: string) =>
  workflowStreamName({
    workflowName: workflowOptions.workflow.name,
    workflowId: groupCheckoutId,
  });

describe('WorkflowHandler', () => {
  it('records the input and the outputs it produced in the workflow stream', async () => {
    const eventStore = getInMemoryEventStore();
    const groupCheckoutId = randomUUID();

    // #region workflow-handler-usage
    const handle = WorkflowHandler(workflowOptions);

    const result = await handle(
      eventStore,
      initiateGroupCheckout(groupCheckoutId),
    );
    // #endregion workflow-handler-usage

    expect(result.appendedMessages.map((message) => message.type)).toEqual([
      'GroupCheckoutInitiated',
      'CheckOut',
      'CheckOut',
    ]);

    const { events } = await eventStore.readStream(streamOf(groupCheckoutId));

    // #region workflow-stream-contents
    expect(events.map((event) => event.type)).toEqual([
      'GroupCheckoutWorkflow:InitiateGroupCheckout', // the input, prefixed
      'GroupCheckoutInitiated',
      'CheckOut',
      'CheckOut',
    ]);
    // #endregion workflow-stream-contents
  });

  it('marks the stored input and tags each output with how it should be dispatched', async () => {
    const eventStore = getInMemoryEventStore();
    const groupCheckoutId = randomUUID();
    const handle = WorkflowHandler(workflowOptions);

    await handle(eventStore, initiateGroupCheckout(groupCheckoutId, ['g-1']));

    const { events } = await eventStore.readStream(streamOf(groupCheckoutId));

    // #region workflow-message-actions
    expect(events[0]!.metadata).toMatchObject({
      input: true,
      action: 'InitiatedBy',
    });
    expect(events[1]!.metadata).toMatchObject({ action: 'Published' });
    expect(events[2]!.metadata).toMatchObject({ action: 'Sent' });
    // #endregion workflow-message-actions
  });

  it('records the input even when the decision produces nothing', async () => {
    const eventStore = getInMemoryEventStore();
    const groupCheckoutId = randomUUID();
    const handle = WorkflowHandler(workflowOptions);

    // #region workflow-no-output
    // GuestCheckedOut for a group checkout that was never initiated
    const result = await handle(eventStore, {
      type: 'GuestCheckedOut',
      data: {
        guestStayAccountId: 'guest-stay-1',
        checkedOutAt: now,
        groupCheckoutId,
      },
    });
    // #endregion workflow-no-output

    expect(result.appendedMessages).toEqual([]);

    const { events } = await eventStore.readStream(streamOf(groupCheckoutId));
    expect(events.map((event) => event.type)).toEqual([
      'GroupCheckoutWorkflow:GuestCheckedOut',
    ]);
  });

  it('ignores an input already recorded under the same message id', async () => {
    const eventStore = getInMemoryEventStore();
    const groupCheckoutId = randomUUID();
    const handle = WorkflowHandler(workflowOptions);

    // #region workflow-idempotent-redelivery
    const messageId = randomUUID();
    const input = delivered(initiateGroupCheckout(groupCheckoutId), messageId);

    await handle(eventStore, input);
    const redelivered = await handle(eventStore, input);

    expect(redelivered.appendedMessages).toEqual([]);
    // #endregion workflow-idempotent-redelivery

    const { events } = await eventStore.readStream(streamOf(groupCheckoutId));
    expect(events.map((event) => event.type)).toEqual([
      'GroupCheckoutWorkflow:InitiateGroupCheckout',
      'GroupCheckoutInitiated',
      'CheckOut',
      'CheckOut',
    ]);
  });

  it('does nothing when getWorkflowId returns null', async () => {
    const eventStore = getInMemoryEventStore();
    const groupCheckoutId = randomUUID();

    // #region workflow-unrouted-input
    const handle = WorkflowHandler({
      ...workflowOptions,
      // a guest checkout outside any group produces no groupCheckoutId
      getWorkflowId: (input) => input.data.groupCheckoutId ?? null,
    });

    const result = await handle(eventStore, {
      type: 'GuestCheckedOut',
      data: { guestStayAccountId: 'guest-stay-1', checkedOutAt: now },
    });

    expect(result.appendedMessages).toEqual([]);
    // #endregion workflow-unrouted-input

    expect(await eventStore.streamExists(streamOf(groupCheckoutId))).toBe(
      false,
    );
  });
});
