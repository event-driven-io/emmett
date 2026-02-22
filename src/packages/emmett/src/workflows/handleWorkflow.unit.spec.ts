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
import type { WorkflowInputMessageMetadata } from './workflow';
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
      messageId: randomUUID(),
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

    // 1 input + 1 GroupCheckoutInitiated + 2 CheckOut = version 4
    assertEqual(first.nextExpectedStreamVersion, 4n);

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

    // No output from decide, but input is still stored, so version bumps to 5
    assertThatArray(second.newMessages).isEmpty();
    assertEqual(second.nextExpectedStreamVersion, 5n);
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

    void it('retries with numeric onVersionConflict', async () => {
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

      const handleWithNumericRetry = WorkflowHandler<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput,
        WorkflowMeta
      >({
        ...workflowOptions,
        workflow: {
          ...GroupCheckoutWorkflow,
          decide: (input, state) => {
            if (tried++ < 2) throw new ExpectedVersionConflictError(0n, 1n);
            return decide(input, state);
          },
        },
        retry: {
          onVersionConflict: 5,
        },
      });

      const { newMessages } = await handleWithNumericRetry(
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

      assertEqual(3, tried);
      assertThatArray(newMessages).hasSize(1);
    });
  });

  void describe('input storage', () => {
    void it('stores input with prefixed type and metadata in the workflow stream', async () => {
      const groupCheckoutId = randomUUID();
      const guestStayAccountIds = [randomUUID()];
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

      await handleWorkflow(eventStore, message, {});

      const { events } = await eventStore.readStream(
        `emt:workflow:${groupCheckoutId}`,
      );

      const storedInput = events[0]!;
      const inputMetadata =
        storedInput.metadata as unknown as WorkflowInputMessageMetadata;

      assertEqual(
        storedInput.type,
        'GroupCheckoutWorkflow:InitiateGroupCheckout',
      );
      assertEqual(inputMetadata.originalMessageId, message.metadata.messageId);
      assertEqual(inputMetadata.input, true);
      assertEqual(inputMetadata.action, 'InitiatedBy');
    });

    void it('upcasts prefixed input types back during state rebuild', async () => {
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

      // Second call rebuilds state from the stream, which contains
      // the prefixed input "GroupCheckout:InitiateGroupCheckout".
      // The upcast must strip the prefix so evolve sees "GroupCheckoutInitiated"
      // (the output event) and the input "InitiateGroupCheckout" correctly.
      const { newMessages } = await handleWorkflow(
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

      // If upcast failed, evolve wouldn't build the Pending state,
      // and decide would return nothing for GuestCheckedOut on a NotExisting state.
      assertThatArray(newMessages).hasSize(1);
      assertEqual(newMessages[0]!.type, 'GroupCheckoutCompleted');
    });

    void it('stores input even when decide produces no output', async () => {
      const groupCheckoutId = randomUUID();
      const guestIds = [randomUUID(), randomUUID()];
      const now = new Date();

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

      // Only one guest checks out — decide returns nothing
      const { newMessages } = await handleWorkflow(
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

      assertThatArray(newMessages).isEmpty();

      const { events } = await eventStore.readStream(
        `emt:workflow:${groupCheckoutId}`,
      );

      // 4 from first call (input + 3 outputs) + 1 input from second call = 5
      assertThatArray(events).hasSize(5);

      const lastEvent = events[4]!;
      assertEqual(lastEvent.type, 'GroupCheckoutWorkflow:GuestCheckedOut');
      assertEqual((lastEvent.metadata as Record<string, unknown>).input, true);
    });

    void it('marks subsequent inputs with received action', async () => {
      const groupCheckoutId = randomUUID();
      const guestIds = [randomUUID(), randomUUID()];
      const now = new Date();

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

      await handleWorkflow(
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

      const { events } = await eventStore.readStream(
        `emt:workflow:${groupCheckoutId}`,
      );
      // Position 4 is the second input (0: first input, 1-3: outputs, 4: second input)
      const secondInput = events[4]!;
      const meta =
        secondInput.metadata as unknown as WorkflowInputMessageMetadata;
      assertEqual(meta.action, 'Received');
      assertEqual(meta.input, true);
    });
  });

  void describe('output action metadata', () => {
    void it('tags output events with published action', async () => {
      const groupCheckoutId = randomUUID();
      const guestStayAccountIds = [randomUUID()];
      const now = new Date();

      await handleWorkflow(
        eventStore,
        recorded<InitiateGroupCheckout>({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds,
            now,
          },
        }),
        {},
      );

      const { events } = await eventStore.readStream(
        `emt:workflow:${groupCheckoutId}`,
      );
      // Position 1 is GroupCheckoutInitiated (an event output)
      const outputEvent = events[1]!;
      assertEqual(
        (outputEvent.metadata as Record<string, unknown>).action,
        'Published',
      );
    });

    void it('tags output commands with sent action', async () => {
      const groupCheckoutId = randomUUID();
      const guestStayAccountIds = [randomUUID()];
      const now = new Date();

      await handleWorkflow(
        eventStore,
        recorded<InitiateGroupCheckout>({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds,
            now,
          },
        }),
        {},
      );

      const { events } = await eventStore.readStream(
        `emt:workflow:${groupCheckoutId}`,
      );
      // Position 2 is CheckOut (a command output)
      const outputCommand = events[2]!;
      assertEqual(
        (outputCommand.metadata as Record<string, unknown>).action,
        'Sent',
      );
    });

    void it('preserves existing metadata on output messages', async () => {
      const groupCheckoutId = randomUUID();
      const guestStayAccountIds = [randomUUID()];
      const now = new Date();
      const customValue = 'custom-correlation-id';

      const handleWithMetadata = WorkflowHandler<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput,
        WorkflowMeta
      >({
        ...workflowOptions,
        workflow: {
          ...GroupCheckoutWorkflow,
          decide: (input) => {
            if (input.type === 'InitiateGroupCheckout') {
              return [
                {
                  type: 'GroupCheckoutInitiated',
                  data: {
                    groupCheckoutId: input.data.groupCheckoutId,
                    clerkId: input.data.clerkId,
                    guestStayAccountIds: input.data.guestStayAccountIds,
                    initiatedAt: input.data.now,
                  },
                  metadata: {
                    customCorrelation: customValue,
                  },
                },
              ];
            }
            return [];
          },
        },
      });

      await handleWithMetadata(
        eventStore,
        recorded<InitiateGroupCheckout>({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds,
            now,
          },
        }),
        {},
      );

      const { events } = await eventStore.readStream(
        `emt:workflow:${groupCheckoutId}`,
      );
      const outputEvent = events[1]!;
      const metadata = outputEvent.metadata as Record<string, unknown>;

      // Both custom metadata and action should be present
      assertEqual(metadata.customCorrelation, customValue);
      assertEqual(metadata.action, 'Published');
    });
  });

  void describe('idempotency', () => {
    void it('skips duplicate input messages', async () => {
      const groupCheckoutId = randomUUID();
      const guestStayAccountIds = [randomUUID()];
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

      // First call processes normally
      const first = await handleWorkflow(eventStore, message, {});
      assertThatArray(first.newMessages).hasSize(2);

      // Second call with same message is skipped
      const second = await handleWorkflow(eventStore, message, {});
      assertThatArray(second.newMessages).isEmpty();

      // Stream has 3 messages (1 input + 2 outputs), not 6
      const { events } = await eventStore.readStream(
        `emt:workflow:${groupCheckoutId}`,
      );
      assertThatArray(events).hasSize(3);
    });

    void it('processes different messages with same workflow id normally', async () => {
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

      // Different message — should process normally
      const { newMessages } = await handleWorkflow(
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

      assertThatArray(newMessages).hasSize(1);
      assertEqual(newMessages[0]!.type, 'GroupCheckoutCompleted');
    });
  });

  void describe('separateInputInboxFromProcessing', () => {
    const separatedWorkflowOptions: WorkflowOptions<
      GroupCheckoutInput,
      GroupCheckout,
      GroupCheckoutOutput,
      WorkflowMeta
    > = {
      ...workflowOptions,
      separateInputInboxFromProcessing: true,
    };

    const handleSeparatedWorkflow = WorkflowHandler(separatedWorkflowOptions);

    void it('stores input without processing when message has no workflow prefix', async () => {
      const groupCheckoutId = randomUUID();

      const { newMessages } = await handleSeparatedWorkflow(
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

      // No outputs — just stored the input
      assertThatArray(newMessages).isEmpty();

      const { events } = await eventStore.readStream(
        `emt:workflow:${groupCheckoutId}`,
      );
      assertThatArray(events).hasSize(1);
      assertEqual(
        events[0]!.type,
        'GroupCheckoutWorkflow:InitiateGroupCheckout',
      );
      const meta = events[0]!
        .metadata as unknown as WorkflowInputMessageMetadata;
      assertEqual(meta.input, true);
      assertEqual(meta.action, 'InitiatedBy');
    });

    void it('processes prefixed input and produces outputs without re-storing input', async () => {
      const groupCheckoutId = randomUUID();
      const guestStayAccountIds = [randomUUID()];
      const now = new Date();

      // First: store the input (no prefix → store only)
      await handleSeparatedWorkflow(
        eventStore,
        recorded<InitiateGroupCheckout>({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds,
            now,
          },
        }),
        {},
      );

      // Second: process the stored input (has prefix → process only)
      const { newMessages } = await handleSeparatedWorkflow(
        eventStore,
        recorded({
          type: 'GroupCheckoutWorkflow:InitiateGroupCheckout',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds,
            now,
          },
        } as unknown as InitiateGroupCheckout),
        {},
      );

      assertThatArray(newMessages).hasSize(2);

      // Stream: 1 stored input + 2 outputs = 3 (input NOT re-stored)
      const { events } = await eventStore.readStream(
        `emt:workflow:${groupCheckoutId}`,
      );
      assertThatArray(events).hasSize(3);
    });

    void it('maintains idempotency across double-hop storage and processing', async () => {
      const groupCheckoutId = randomUUID();
      const guestStayAccountIds = [randomUUID()];
      const now = new Date();

      const externalMessage = recorded<InitiateGroupCheckout>({
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds,
          now,
        },
      });

      // First: store the input (no prefix → store only)
      await handleSeparatedWorkflow(eventStore, externalMessage, {});

      // Second: process the stored input (has prefix → process only)
      const prefixedMessage = recorded({
        type: 'GroupCheckoutWorkflow:InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds,
          now,
        },
        metadata: {
          ...externalMessage.metadata,
          // Same messageId as external input
          messageId: externalMessage.metadata.messageId,
        },
      } as unknown as InitiateGroupCheckout);

      const first = await handleSeparatedWorkflow(
        eventStore,
        prefixedMessage,
        {},
      );
      assertThatArray(first.newMessages).hasSize(2);

      // Third: try to process the same prefixed input again → should be skipped
      const second = await handleSeparatedWorkflow(
        eventStore,
        prefixedMessage,
        {},
      );
      assertThatArray(second.newMessages).isEmpty();

      // Stream: 1 stored input + 2 outputs = 3 (not 1 + 2 + 2)
      const { events } = await eventStore.readStream(
        `emt:workflow:${groupCheckoutId}`,
      );
      assertThatArray(events).hasSize(3);
    });

    void it('works as normal when flag is false', async () => {
      const groupCheckoutId = randomUUID();
      const guestStayAccountIds = [randomUUID()];
      const now = new Date();

      const { newMessages } = await handleWorkflow(
        eventStore,
        recorded<InitiateGroupCheckout>({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds,
            now,
          },
        }),
        {},
      );

      // Normal behavior: processes immediately, returns outputs
      assertThatArray(newMessages).hasSize(2);
    });
  });

  void describe('mapWorkflowId', () => {
    void it('uses custom stream name mapping', async () => {
      const groupCheckoutId = randomUUID();
      const customStreamName = `custom:checkout:${groupCheckoutId}`;

      const handleWithMapping = WorkflowHandler<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput,
        WorkflowMeta
      >({
        ...workflowOptions,
        mapWorkflowId: (id) => `custom:checkout:${id}`,
      });

      await handleWithMapping(
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

      const { events } = await eventStore.readStream(customStreamName);
      assertTrue(events.length > 0);
      assertEqual(
        events[0]!.type,
        'GroupCheckoutWorkflow:InitiateGroupCheckout',
      );
    });
  });

  void it('accepts both retry and expectedStreamVersion in handle options', async () => {
    const groupCheckoutId = randomUUID();
    const guestStayAccountIds = [randomUUID(), randomUUID()];
    const now = new Date();

    const { newMessages, createdNewStream } = await handleWorkflow(
      eventStore,
      recorded<InitiateGroupCheckout>({
        type: 'InitiateGroupCheckout',
        data: { groupCheckoutId, clerkId: 'clerk-1', guestStayAccountIds, now },
      }),
      {
        expectedStreamVersion: 'STREAM_DOES_NOT_EXIST',
        retry: { onVersionConflict: true },
      },
    );

    assertTrue(createdNewStream);
    assertThatArray(newMessages).hasSize(3);
  });
});
