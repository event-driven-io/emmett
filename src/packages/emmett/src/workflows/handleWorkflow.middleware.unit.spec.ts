import { describe, expect, it } from 'vitest';
import { after, before, rejectOn } from '../commandHandling';
import {
  ExpectedVersionConflictError,
  getInMemoryEventStore,
} from '../eventStore';
import { WorkflowHandler, workflowStreamName } from './handleWorkflow';
import {
  workflowOptions,
  type GroupCheckoutOutput,
  type InitiateGroupCheckout,
} from './workflow.testHelpers';

const initiateGroupCheckout = (
  groupCheckoutId: string,
  guestStayAccountIds = ['guest-stay-1', 'guest-stay-2'],
): InitiateGroupCheckout => ({
  type: 'InitiateGroupCheckout',
  data: {
    groupCheckoutId,
    clerkId: 'clerk-1',
    guestStayAccountIds,
    now: new Date('2026-01-01T10:00:00Z'),
  },
});

describe('WorkflowHandler middleware', () => {
  it('returns rejected workflow outputs while retaining the durable input', async () => {
    const eventStore = getInMemoryEventStore();
    const input = initiateGroupCheckout('group-checkout-1', []);
    // #region workflow-output-rejection
    const handle = WorkflowHandler({
      ...workflowOptions,
      middleware: [
        rejectOn(
          (message: GroupCheckoutOutput) =>
            message.type === 'GroupCheckoutRejected',
        ),
      ],
    });

    const result = await handle(eventStore, input);
    // #endregion workflow-output-rejection

    expect(result.messages.map((message) => message.type)).toEqual([
      'GroupCheckoutRejected',
    ]);
    expect(result.appendedMessages).toEqual([]);

    const streamName = workflowStreamName({
      workflowName: workflowOptions.workflow.name,
      workflowId: input.data.groupCheckoutId,
    });
    expect(
      (await eventStore.readStream(streamName)).events.map(
        (event) => event.type,
      ),
    ).toEqual(['GroupCheckoutWorkflow:InitiateGroupCheckout']);
  });

  it('runs invocation hooks once and decision middleware for every retry', async () => {
    const eventStore = getInMemoryEventStore();
    const input = initiateGroupCheckout('group-checkout-retry');
    let authorizationChecks = 0;
    let measuredDecisions = 0;
    let measuredInvocations = 0;
    const handle = WorkflowHandler({
      ...workflowOptions,
      middleware: {
        beforeAll: () => {
          authorizationChecks++;
        },
        afterAll: () => {
          measuredInvocations++;
        },
        decision: [
          before(() => {
            measuredDecisions++;
          }),
          after((result) => {
            if (measuredDecisions === 1)
              throw new ExpectedVersionConflictError(0n, 1n);
            return result;
          }),
        ],
      },
      retry: {
        retries: 1,
        minTimeout: 1,
        factor: 1,
        shouldRetryError: (error) =>
          error instanceof ExpectedVersionConflictError,
      },
    });

    const result = await handle(eventStore, input);

    expect(authorizationChecks).toBe(1);
    expect(measuredDecisions).toBe(2);
    expect(measuredInvocations).toBe(1);
    expect(result.messages).toEqual(result.appendedMessages);
  });
});
