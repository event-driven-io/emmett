---
documentationType: how-to-guide
outline: deep
---

# Workflows & Sagas

Coordinate multi-step business processes with durable execution and full observability.

## Overview

Workflows in Emmett handle complex, multi-step business processes that span across different parts of your system. They coordinate operations, handle failures gracefully, maintain state between steps, and provide visibility into what's happening.

**Common workflow scenarios:**

- Hotel group checkout coordinating multiple room settlements
- Order fulfillment with payment, inventory, and shipping
- Customer onboarding with verification steps
- Document review with multiple approvers
- Incident response coordination across teams

## Why Workflows?

Multi-step processes need to survive failures. A group checkout may be quick, but a document review workflow can span days. When things fail, you need to know exactly where you stopped and why.

DIY solutions always have gaps:
- Messages lost during deployment
- Processes stuck after partial failures
- No way to resume after fixing bugs
- Can't answer "what happened to order X?"

Emmett workflows solve these problems using event sourcing as the foundation for durable execution.

## The Workflow Pattern

Workflows follow the same mental model as [command handlers](/getting-started#command-handling): they receive commands, make decisions based on state, and produce new messages. But unlike command handlers that only respond to commands, workflows can also react to events from anywhere in your system.

### Three Core Functions

```typescript
type Workflow<Input, State, Output> = {
  // Business logic: input + state → outputs
  decide: (input: Input, state: State) => WorkflowOutput<Output>;

  // State evolution from events
  evolve: (state: State, event: WorkflowEvent<Input | Output>) => State;

  // Starting state for new instances
  initialState: () => State;
};
```

### How It Works

Each workflow instance gets its own event stream that serves as both inbox (recording inputs) and outbox (recording outputs):

```
Workflow Stream Contents:
Pos | Kind    | Direction | Message
----|---------|-----------|------------------------------------------
1   | Command | Input     | InitiateGroupCheckout {groupId: '123'}
2   | Event   | Output    | GroupCheckoutInitiated
3   | Command | Output    | CheckOut {guestId: 'g1'}
4   | Command | Output    | CheckOut {guestId: 'g2'}
5   | Event   | Input     | GuestCheckedOut {guestId: 'g1'}
6   | Event   | Input     | GuestCheckoutFailed {guestId: 'g2'}
7   | Event   | Output    | GroupCheckoutFailed
```

## Example: Group Checkout

Let's implement a hotel group checkout that coordinates multiple individual checkouts.

### Define the State

```typescript
type GuestStayStatus = 'Pending' | 'Completed' | 'Failed';

type GroupCheckout =
  | { status: 'NotExisting' }
  | {
      status: 'Pending';
      guestStayAccountIds: Map<string, GuestStayStatus>;
    }
  | { status: 'Finished' };

const initialState = (): GroupCheckout => ({ status: 'NotExisting' });
```

### Define Input and Output Messages

```typescript
// Commands and events the workflow receives
type GroupCheckoutInput =
  | Command<'InitiateGroupCheckout', {
      groupCheckoutId: string;
      guestStayAccountIds: string[]
    }>
  | Event<'GuestCheckedOut', {
      guestStayAccountId: string;
      groupCheckoutId: string;
    }>
  | Event<'GuestCheckoutFailed', {
      guestStayAccountId: string;
      groupCheckoutId: string;
      reason: string;
    }>
  | Command<'TimeoutGroupCheckout', { groupCheckoutId: string }>;

// Commands and events the workflow produces
type GroupCheckoutOutput =
  | Event<'GroupCheckoutInitiated', {
      groupCheckoutId: string;
      guestStayAccountIds: string[];
    }>
  | Command<'CheckOut', { guestStayAccountId: string }>
  | Event<'GroupCheckoutCompleted', {
      groupCheckoutId: string;
      completedCheckouts: string[];
    }>
  | Event<'GroupCheckoutFailed', {
      groupCheckoutId: string;
      completedCheckouts: string[];
      failedCheckouts: string[];
    }>
  | Event<'GroupCheckoutTimedOut', { groupCheckoutId: string }>;
```

### Implement the Decide Function

```typescript
const decide = (
  input: GroupCheckoutInput,
  state: GroupCheckout,
): WorkflowOutput<GroupCheckoutOutput> => {
  switch (input.type) {
    case 'InitiateGroupCheckout':
      return initiateGroupCheckout(input, state);
    case 'GuestCheckedOut':
    case 'GuestCheckoutFailed':
      return onCheckoutFinished(input, state);
    case 'TimeoutGroupCheckout':
      return timedOut(input, state);
  }
};

const initiateGroupCheckout = (
  command: Command<'InitiateGroupCheckout', {
    groupCheckoutId: string;
    guestStayAccountIds: string[]
  }>,
  state: GroupCheckout,
): WorkflowOutput<GroupCheckoutOutput> => {
  if (state.status !== 'NotExisting') {
    return [];
  }

  const { groupCheckoutId, guestStayAccountIds } = command.data;

  return [
    // Record that checkout was initiated
    {
      kind: 'Event',
      type: 'GroupCheckoutInitiated',
      data: { groupCheckoutId, guestStayAccountIds },
    },
    // Schedule individual checkouts
    ...guestStayAccountIds.map((guestStayAccountId) => ({
      kind: 'Command' as const,
      type: 'CheckOut' as const,
      data: { guestStayAccountId },
    })),
  ];
};

const onCheckoutFinished = (
  event: Event<'GuestCheckedOut' | 'GuestCheckoutFailed', {
    guestStayAccountId: string;
    groupCheckoutId: string;
  }>,
  state: GroupCheckout,
): WorkflowOutput<GroupCheckoutOutput> => {
  if (state.status !== 'Pending') {
    return [];
  }

  // Check if all checkouts are complete
  const allCompleted = [...state.guestStayAccountIds.entries()].every(
    ([id, status]) =>
      status !== 'Pending' ||
      id === event.data.guestStayAccountId
  );

  if (!allCompleted) {
    return []; // Wait for more checkouts
  }

  const completed: string[] = [];
  const failed: string[] = [];

  for (const [id, status] of state.guestStayAccountIds) {
    if (id === event.data.guestStayAccountId) {
      if (event.type === 'GuestCheckedOut') {
        completed.push(id);
      } else {
        failed.push(id);
      }
    } else if (status === 'Completed') {
      completed.push(id);
    } else if (status === 'Failed') {
      failed.push(id);
    }
  }

  if (failed.length === 0) {
    return [{
      kind: 'Event',
      type: 'GroupCheckoutCompleted',
      data: {
        groupCheckoutId: event.data.groupCheckoutId,
        completedCheckouts: completed,
      },
    }];
  }

  return [{
    kind: 'Event',
    type: 'GroupCheckoutFailed',
    data: {
      groupCheckoutId: event.data.groupCheckoutId,
      completedCheckouts: completed,
      failedCheckouts: failed,
    },
  }];
};
```

### Implement State Evolution

```typescript
const evolve = (
  state: GroupCheckout,
  { type, data }: WorkflowEvent<GroupCheckoutInput | GroupCheckoutOutput>,
): GroupCheckout => {
  switch (type) {
    case 'GroupCheckoutInitiated': {
      if (state.status !== 'NotExisting') return state;

      return {
        status: 'Pending',
        guestStayAccountIds: data.guestStayAccountIds.reduce(
          (map, id) => map.set(id, 'Pending'),
          new Map<string, GuestStayStatus>(),
        ),
      };
    }
    case 'GuestCheckedOut':
    case 'GuestCheckoutFailed': {
      if (state.status !== 'Pending') return state;

      return {
        ...state,
        guestStayAccountIds: state.guestStayAccountIds.set(
          data.guestStayAccountId,
          type === 'GuestCheckedOut' ? 'Completed' : 'Failed',
        ),
      };
    }
    case 'GroupCheckoutCompleted':
    case 'GroupCheckoutFailed':
    case 'GroupCheckoutTimedOut': {
      if (state.status !== 'Pending') return state;
      return { status: 'Finished' };
    }
    default:
      return state;
  }
};
```

### Register the Workflow

```typescript
import { workflowProcessor } from '@event-driven-io/emmett';

const GroupCheckoutWorkflow: Workflow<
  GroupCheckoutInput,
  GroupCheckout,
  GroupCheckoutOutput
> = {
  decide,
  evolve,
  initialState,
};

const groupCheckoutProcessor = workflowProcessor({
  processorId: 'GroupCheckoutWorkflow',
  workflow: GroupCheckoutWorkflow,
  getWorkflowId: (input) => input.data.groupCheckoutId,
  inputs: {
    commands: ['InitiateGroupCheckout', 'TimeoutGroupCheckout'],
    events: ['GuestCheckedOut', 'GuestCheckoutFailed'],
  },
  outputs: {
    commands: ['CheckOut'],
    events: [
      'GroupCheckoutInitiated',
      'GroupCheckoutCompleted',
      'GroupCheckoutFailed',
      'GroupCheckoutTimedOut',
    ],
  },
});
```

## Testing Workflows

Workflows are pure functions, making them easy to test:

### Unit Testing

```typescript
import { DeciderSpecification } from '@event-driven-io/emmett';

const spec = DeciderSpecification.for({
  decide,
  evolve,
  initialState,
});

describe('GroupCheckoutWorkflow', () => {
  it('initiates checkout for all guests', () =>
    spec([])
      .when({
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId: 'gc-123',
          guestStayAccountIds: ['g1', 'g2'],
        },
      })
      .then([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-123',
            guestStayAccountIds: ['g1', 'g2'],
          },
        },
        { type: 'CheckOut', data: { guestStayAccountId: 'g1' } },
        { type: 'CheckOut', data: { guestStayAccountId: 'g2' } },
      ]));

  it('handles partial failures', () =>
    spec([
      {
        type: 'GroupCheckoutInitiated',
        data: { groupCheckoutId: 'gc-123', guestStayAccountIds: ['g1', 'g2'] },
      },
      {
        type: 'GuestCheckedOut',
        data: { guestStayAccountId: 'g1', groupCheckoutId: 'gc-123' },
      },
    ])
      .when({
        type: 'GuestCheckoutFailed',
        data: {
          guestStayAccountId: 'g2',
          groupCheckoutId: 'gc-123',
          reason: 'BalanceNotSettled',
        },
      })
      .then([
        {
          type: 'GroupCheckoutFailed',
          data: {
            groupCheckoutId: 'gc-123',
            completedCheckouts: ['g1'],
            failedCheckouts: ['g2'],
          },
        },
      ]));
});
```

## When to Use Workflows

**Use workflows for:**
- Multi-step processes spanning multiple aggregates
- Long-running operations (hours, days)
- Processes requiring coordination across streams
- Operations needing full audit trail

**Don't use workflows for:**
- Simple request-response operations → use [command handlers](/api-reference/commandhandler)
- Building read models → use [projections](/guides/projections)
- Simple event reactions → use reactors
- Synchronous single-aggregate operations

## Recovery and Durability

Because workflows use event sourcing:

1. **Crash Recovery**: On restart, replay the stream to rebuild state
2. **No Special Code**: Same code path handles normal processing and recovery
3. **Time Travel Debugging**: Replay event-by-event to see exact decision sequence
4. **Full Audit Trail**: Every decision recorded with its trigger

## Further Reading

- [The Workflow Pattern](https://blog.bittacklr.be/the-workflow-pattern.html) by Yves Reynhout
- [How TypeScript can help in modelling business workflows](https://event-driven.io/en/how_to_have_fun_with_typescript_and_workflow/)
- [How to build an in-memory Message Bus in TypeScript](https://event-driven.io/en/inmemory_message_bus_in_typescript/)

## See Also

- [Command Handler](/api-reference/commandhandler) - For simpler command processing
- [Projections](/guides/projections) - For building read models
- [Testing Patterns](/guides/testing) - For comprehensive testing strategies
