import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  ExpectedVersionConflictError,
  getInMemoryEventStore,
} from '../eventStore';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertThatArray,
  assertThrowsAsync,
  assertTrue,
} from '../testing';
import type { AnyReadEventMetadata, RecordedMessage } from '../typing';
import { WorkflowHandler } from './handleWorkflow';
import {
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
  type GuestCheckedOut,
  type GuestCheckoutFailed,
  type InitiateGroupCheckout,
  type TimeoutGroupCheckout,
  GroupCheckoutWorkflow,
  decide,
} from './workflow.unit.spec';
import type { WorkflowOptions } from './workflowProcessor';

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

const handleWorkflow = WorkflowHandler(workflowOptions);

const recorded = <T extends GroupCheckoutInput>(
  message: T,
): RecordedMessage<T> =>
  ({
    ...message,
    kind: 'Event',
    metadata: {
      streamName: `test-${randomUUID()}`,
      streamPosition: 1n,
    },
  }) as unknown as RecordedMessage<T>;

void describe('Workflow Handler', () => {
  const eventStore = getInMemoryEventStore();

  void it('returns output messages when initiating a group checkout', async () => {
    const groupCheckoutId = randomUUID();
    const guestStayAccountIds = [randomUUID(), randomUUID()];
    const now = new Date();

    const message = recorded<InitiateGroupCheckout>({
      type: 'InitiateGroupCheckout',
      data: {
        groupCheckoutId,
        clerkId: 'clerk-1',
        guestStayAccountIds,
        now,
      },
    });

    const { newMessages, createdNewStream } = await handleWorkflow(
      eventStore,
      message,
      {},
    );

    assertTrue(createdNewStream);
    assertThatArray(newMessages).hasSize(3);
    assertDeepEqual(newMessages[0], {
      type: 'GroupCheckoutInitiated',
      data: {
        groupCheckoutId,
        guestStayAccountIds,
        initiatedAt: now,
        clerkId: 'clerk-1',
      },
    });
    assertDeepEqual(newMessages[1], {
      type: 'CheckOut',
      data: {
        guestStayAccountId: guestStayAccountIds[0]!,
        groupCheckoutId,
      },
      metadata: { now },
    });
    assertDeepEqual(newMessages[2], {
      type: 'CheckOut',
      data: {
        guestStayAccountId: guestStayAccountIds[1]!,
        groupCheckoutId,
      },
      metadata: { now },
    });
  });

  void it('returns empty messages when getWorkflowId returns null', async () => {
    const handleWithNullId = WorkflowHandler<
      GroupCheckoutInput,
      GroupCheckout,
      GroupCheckoutOutput,
      WorkflowMeta
    >({
      ...workflowOptions,
      getWorkflowId: () => null,
    });

    const message = recorded<InitiateGroupCheckout>({
      type: 'InitiateGroupCheckout',
      data: {
        groupCheckoutId: randomUUID(),
        clerkId: 'clerk-1',
        guestStayAccountIds: [randomUUID()],
        now: new Date(),
      },
    });

    const { newMessages } = await handleWithNullId(eventStore, message, {});

    assertThatArray(newMessages).isEmpty();
  });

  void it('returns empty messages when decide produces nothing for unknown group checkout', async () => {
    const message = recorded<GuestCheckedOut>({
      type: 'GuestCheckedOut',
      data: {
        guestStayAccountId: randomUUID(),
        checkedOutAt: new Date(),
      },
    });

    const { newMessages, createdNewStream } = await handleWorkflow(
      eventStore,
      message,
      {},
    );

    assertFalse(createdNewStream);
    assertThatArray(newMessages).isEmpty();
  });

  void it('completes group checkout after all guests check out', async () => {
    const groupCheckoutId = randomUUID();
    const guestId = randomUUID();
    const now = new Date();

    await handleWorkflow(
      eventStore,
      recorded<InitiateGroupCheckout>({
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds: [guestId],
          now,
        },
      }),
      {},
    );

    const { newMessages, createdNewStream } = await handleWorkflow(
      eventStore,
      recorded<GuestCheckedOut>({
        type: 'GuestCheckedOut',
        data: {
          guestStayAccountId: guestId,
          checkedOutAt: now,
          groupCheckoutId,
        },
      }),
      {},
    );

    assertFalse(createdNewStream);
    assertThatArray(newMessages).hasSize(1);
    assertDeepEqual(newMessages[0], {
      type: 'GroupCheckoutCompleted',
      data: {
        groupCheckoutId,
        completedCheckouts: ['Completed'],
        completedAt: now,
      },
    });
  });

  void it('tracks stream version across multiple appends', async () => {
    const groupCheckoutId = randomUUID();
    const guestIds = [randomUUID(), randomUUID()];
    const now = new Date();

    const first = await handleWorkflow(
      eventStore,
      recorded<InitiateGroupCheckout>({
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds: guestIds,
          now,
        },
      }),
      {},
    );

    // 1 GroupCheckoutInitiated + 2 CheckOut = version 3
    assertEqual(first.nextExpectedStreamVersion, 3n);

    const second = await handleWorkflow(
      eventStore,
      recorded<GuestCheckedOut>({
        type: 'GuestCheckedOut',
        data: {
          guestStayAccountId: guestIds[0]!,
          checkedOutAt: now,
          groupCheckoutId,
        },
      }),
      {},
    );

    // Still one pending guest, so no output, version stays at 3
    assertThatArray(second.newMessages).isEmpty();
    assertEqual(second.nextExpectedStreamVersion, 3n);
  });

  void it('fails the group checkout when a guest checkout fails', async () => {
    const groupCheckoutId = randomUUID();
    const guestId = randomUUID();
    const now = new Date();

    await handleWorkflow(
      eventStore,
      recorded<InitiateGroupCheckout>({
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds: [guestId],
          now,
        },
      }),
      {},
    );

    const failedAt = new Date();
    const { newMessages } = await handleWorkflow(
      eventStore,
      recorded<GuestCheckoutFailed>({
        type: 'GuestCheckoutFailed',
        data: {
          guestStayAccountId: guestId,
          reason: 'BalanceNotSettled',
          failedAt,
          groupCheckoutId,
        },
      }),
      {},
    );

    assertThatArray(newMessages).hasSize(1);
    assertDeepEqual(newMessages[0], {
      type: 'GroupCheckoutFailed',
      data: {
        groupCheckoutId,
        completedCheckouts: [],
        failedCheckouts: [guestId],
        failedAt,
      },
    });
  });

  void it('times out a pending group checkout', async () => {
    const groupCheckoutId = randomUUID();
    const guestIds = [randomUUID(), randomUUID()];
    const now = new Date();
    const timeOutAt = new Date(now.getTime() + 60000);

    await handleWorkflow(
      eventStore,
      recorded<InitiateGroupCheckout>({
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds: guestIds,
          now,
        },
      }),
      {},
    );

    const { newMessages } = await handleWorkflow(
      eventStore,
      recorded<TimeoutGroupCheckout>({
        type: 'TimeoutGroupCheckout',
        data: {
          groupCheckoutId,
          startedAt: now,
          timeOutAt,
        },
      }),
      {},
    );

    assertThatArray(newMessages).hasSize(1);
    assertDeepEqual(newMessages[0], {
      type: 'GroupCheckoutTimedOut',
      data: {
        groupCheckoutId,
        incompleteCheckouts: guestIds,
        completedCheckouts: [],
        failedCheckouts: [],
        timedOutAt: timeOutAt,
      },
    });
  });

  void it('passes handle options with explicit expected stream version', async () => {
    const groupCheckoutId = randomUUID();

    const { nextExpectedStreamVersion, createdNewStream } =
      await handleWorkflow(
        eventStore,
        recorded<InitiateGroupCheckout>({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds: [randomUUID()],
            now: new Date(),
          },
        }),
        {},
        { expectedStreamVersion: 'STREAM_DOES_NOT_EXIST' },
      );

    assertTrue(createdNewStream);
    assertTrue(nextExpectedStreamVersion > 0n);
  });

  void it('fails with explicit expected version on existing stream', async () => {
    const groupCheckoutId = randomUUID();

    await handleWorkflow(
      eventStore,
      recorded<InitiateGroupCheckout>({
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds: [randomUUID()],
          now: new Date(),
        },
      }),
      {},
    );

    await assertThrowsAsync(
      async () => {
        await handleWorkflow(
          eventStore,
          recorded<InitiateGroupCheckout>({
            type: 'InitiateGroupCheckout',
            data: {
              groupCheckoutId,
              clerkId: 'clerk-2',
              guestStayAccountIds: [randomUUID()],
              now: new Date(),
            },
          }),
          {},
          { expectedStreamVersion: 'STREAM_DOES_NOT_EXIST' },
        );
      },
      (error) => error instanceof ExpectedVersionConflictError,
    );
  });

  void describe('retries', () => {
    void it('retries on version conflict and succeeds', async () => {
      const groupCheckoutId = randomUUID();
      const guestId = randomUUID();
      const now = new Date();

      await handleWorkflow(
        eventStore,
        recorded<InitiateGroupCheckout>({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds: [guestId],
            now,
          },
        }),
        {},
      );

      let tried = 0;

      const handleWithRetry = WorkflowHandler<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput,
        WorkflowMeta
      >({
        ...workflowOptions,
        workflow: {
          ...GroupCheckoutWorkflow,
          decide: (input, state) => {
            if (tried++ === 0) throw new ExpectedVersionConflictError(0n, 1n);
            return decide(input, state);
          },
        },
        retry: { onVersionConflict: 10 },
      });

      const { newMessages } = await handleWithRetry(
        eventStore,
        recorded<GuestCheckedOut>({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: guestId,
            checkedOutAt: now,
            groupCheckoutId,
          },
        }),
        {},
      );

      assertEqual(2, tried);
      assertThatArray(newMessages).hasSize(1);
      assertDeepEqual(newMessages[0], {
        type: 'GroupCheckoutCompleted',
        data: {
          groupCheckoutId,
          completedCheckouts: ['Completed'],
          completedAt: now,
        },
      });
    });

    void it('fails after exhausting retries on version conflicts', async () => {
      const groupCheckoutId = randomUUID();
      const guestId = randomUUID();
      const now = new Date();

      await handleWorkflow(
        eventStore,
        recorded<InitiateGroupCheckout>({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds: [guestId],
            now,
          },
        }),
        {},
      );

      let tried = 0;

      const handleWithRetry = WorkflowHandler<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput,
        WorkflowMeta
      >({
        ...workflowOptions,
        workflow: {
          ...GroupCheckoutWorkflow,
          decide: () => {
            tried++;
            throw new ExpectedVersionConflictError(0n, 1n);
          },
        },
        retry: { onVersionConflict: 2 },
      });

      await assertThrowsAsync(
        async () => {
          await handleWithRetry(
            eventStore,
            recorded<GuestCheckedOut>({
              type: 'GuestCheckedOut',
              data: {
                guestStayAccountId: guestId,
                checkedOutAt: now,
                groupCheckoutId,
              },
            }),
            {},
          );
        },
        (error) => error instanceof ExpectedVersionConflictError,
      );

      assertEqual(3, tried);
    });

    void it('does not retry when retry is not configured', async () => {
      const groupCheckoutId = randomUUID();
      const guestId = randomUUID();
      const now = new Date();

      await handleWorkflow(
        eventStore,
        recorded<InitiateGroupCheckout>({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds: [guestId],
            now,
          },
        }),
        {},
      );

      let tried = 0;

      const handleNoRetry = WorkflowHandler<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput,
        WorkflowMeta
      >({
        ...workflowOptions,
        workflow: {
          ...GroupCheckoutWorkflow,
          decide: () => {
            tried++;
            throw new ExpectedVersionConflictError(0n, 1n);
          },
        },
      });

      await assertThrowsAsync(
        async () => {
          await handleNoRetry(
            eventStore,
            recorded<GuestCheckedOut>({
              type: 'GuestCheckedOut',
              data: {
                guestStayAccountId: guestId,
                checkedOutAt: now,
                groupCheckoutId,
              },
            }),
            {},
          );
        },
        (error) => error instanceof ExpectedVersionConflictError,
      );

      assertEqual(1, tried);
    });

    void it('succeeds with custom retry options', async () => {
      const groupCheckoutId = randomUUID();
      const guestId = randomUUID();
      const now = new Date();

      await handleWorkflow(
        eventStore,
        recorded<InitiateGroupCheckout>({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds: [guestId],
            now,
          },
        }),
        {},
      );

      let tried = 0;

      const handleWithCustomRetry = WorkflowHandler<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput,
        WorkflowMeta
      >({
        ...workflowOptions,
        workflow: {
          ...GroupCheckoutWorkflow,
          decide: (input, state) => {
            if (tried++ < 3) throw new ExpectedVersionConflictError(0n, 1n);
            return decide(input, state);
          },
        },
        retry: {
          onVersionConflict: { retries: 3, factor: 1, minTimeout: 10 },
        },
      });

      const { newMessages } = await handleWithCustomRetry(
        eventStore,
        recorded<GuestCheckedOut>({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: guestId,
            checkedOutAt: now,
            groupCheckoutId,
          },
        }),
        {},
      );

      assertEqual(4, tried);
      assertThatArray(newMessages).hasSize(1);
      assertDeepEqual(newMessages[0], {
        type: 'GroupCheckoutCompleted',
        data: {
          groupCheckoutId,
          completedCheckouts: ['Completed'],
          completedAt: now,
        },
      });
    });
  });
});
