import { ObservabilitySpec } from '@event-driven-io/almanac';
import { describe, expect, it } from 'vitest';
import { getInMemoryEventStore } from '../eventStore';
import { EmmettError } from '../errors';
import type { Command } from '../typing';
import { WorkflowHandler, workflowStreamName } from './handleWorkflow';
import {
  workflowOptions,
  type InitiateGroupCheckout,
} from './workflow.testHelpers';

const input: InitiateGroupCheckout = {
  type: 'InitiateGroupCheckout',
  data: {
    groupCheckoutId: 'group-checkout-1',
    clerkId: 'clerk-1',
    guestStayAccountIds: ['guest-stay-1'],
    now: new Date('2026-01-01T10:00:00Z'),
  },
};

describe('WorkflowHandler', () => {
  it('skips a message without a workflow id and does not map an empty id to a stream', async () => {
    const eventStore = getInMemoryEventStore();
    const handle = WorkflowHandler({
      ...workflowOptions,
      getWorkflowId: () => null,
      mapWorkflowId: (workflowId) => {
        if (!workflowId) throw new Error('The workflow id is empty');
        return `workflow-${workflowId}`;
      },
    });

    const result = await handle(eventStore, input);

    expect(result.newMessages).toEqual([]);
  });

  it('runs no invocation hooks for a message without a workflow id', async () => {
    const eventStore = getInMemoryEventStore();
    let hooksRun = 0;
    const handle = WorkflowHandler({
      ...workflowOptions,
      getWorkflowId: () => null,
      middleware: {
        beforeAll: () => {
          hooksRun++;
        },
        afterAll: () => {
          hooksRun++;
        },
      },
    });

    await handle(eventStore, input);

    expect(hooksRun).toBe(0);
  });

  it('opens no workflow span for a message without a workflow id', async () => {
    await ObservabilitySpec.for()((observability) =>
      WorkflowHandler({
        ...workflowOptions,
        getWorkflowId: () => null,
        observability,
      }),
    )
      .when((handle, { tracer }) =>
        handle(getInMemoryEventStore(), input).then(() => tracer.spans.length),
      )
      .then(({ result }) => expect(result).toBe(0));
  });

  it('throws and appends nothing when decide returns a message of an input type', async () => {
    type PaymentCommand = Command<string, { paymentId: string }>;
    type TimeOutPayment = Command<'TimeOutPayment', { paymentId: string }>;

    const eventStore = getInMemoryEventStore();
    const handle = WorkflowHandler<PaymentCommand, object, TimeOutPayment>({
      workflow: {
        name: 'PaymentTimeout',
        initialState: () => ({}),
        evolve: (state) => state,
        decide: ({ data }) => [{ type: 'TimeOutPayment', data }],
      },
      getWorkflowId: ({ data }) => data.paymentId,
      inputs: { commands: ['TimeOutPayment'], events: [] },
      outputs: { commands: ['TimeOutPayment'], events: [] },
    });

    const result = handle(eventStore, {
      type: 'TimeOutPayment',
      data: { paymentId: 'payment-1' },
    });

    await expect(result).rejects.toBeInstanceOf(EmmettError);
    await expect(result).rejects.toThrow(
      "Workflow 'PaymentTimeout' cannot output 'TimeOutPayment', because it is also one of its inputs.",
    );
    expect(
      await eventStore.streamExists(
        workflowStreamName({
          workflowName: 'PaymentTimeout',
          workflowId: 'payment-1',
        }),
      ),
    ).toBe(false);
  });
});
