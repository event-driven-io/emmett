---
documentationType: reference
outline: deep
---

# Workflows

Workflows coordinate multi-step business processes across aggregates with durable execution.

## Overview

Workflows extend the Decider pattern to handle:
- Multi-aggregate coordination
- Long-running processes (hours, days)
- Failure recovery with automatic replay
- Full audit trail of decisions

## Type Definitions

### Workflow

```typescript
type Workflow<Input, State, Output> = {
  decide: (input: Input, state: State) => WorkflowOutput<Output>;
  evolve: (state: State, event: WorkflowEvent<Input | Output>) => State;
  initialState: () => State;
};
```

### WorkflowOutput

```typescript
type WorkflowOutput<Output> = Array<
  | { kind: 'Event'; type: string; data: unknown }
  | { kind: 'Command'; type: string; data: unknown }
>;
```

Workflows can emit both events (facts) and commands (requests to other aggregates).

### WorkflowEvent

Events in a workflow stream include both inputs and outputs:

```typescript
type WorkflowEvent<Message> = {
  type: Message['type'];
  data: Message['data'];
  kind: 'Event' | 'Command';
};
```

## Workflow Processor

### Registration

```typescript
import { workflowProcessor } from '@event-driven-io/emmett';

const processor = workflowProcessor({
  processorId: 'GroupCheckoutWorkflow',
  workflow: groupCheckoutWorkflow,
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
    ],
  },
});
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `processorId` | `string` | Unique identifier for the processor |
| `workflow` | `Workflow` | The workflow definition |
| `getWorkflowId` | `(input) => string` | Extract workflow instance ID from input |
| `inputs.commands` | `string[]` | Command types this workflow receives |
| `inputs.events` | `string[]` | Event types this workflow receives |
| `outputs.commands` | `string[]` | Command types this workflow emits |
| `outputs.events` | `string[]` | Event types this workflow emits |

## Building a Workflow

### Step 1: Define State

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

### Step 2: Define Messages

```typescript
import type { Command, Event } from '@event-driven-io/emmett';

// Input messages
type GroupCheckoutInput =
  | Command<'InitiateGroupCheckout', {
      groupCheckoutId: string;
      guestStayAccountIds: string[];
    }>
  | Event<'GuestCheckedOut', {
      guestStayAccountId: string;
      groupCheckoutId: string;
    }>
  | Event<'GuestCheckoutFailed', {
      guestStayAccountId: string;
      groupCheckoutId: string;
      reason: string;
    }>;

// Output messages
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
    }>;
```

### Step 3: Implement decide

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
  }
};

const initiateGroupCheckout = (
  command: Command<'InitiateGroupCheckout', {...}>,
  state: GroupCheckout,
): WorkflowOutput<GroupCheckoutOutput> => {
  if (state.status !== 'NotExisting') return [];

  const { groupCheckoutId, guestStayAccountIds } = command.data;

  return [
    // Record initiation
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
```

### Step 4: Implement evolve

```typescript
const evolve = (
  state: GroupCheckout,
  event: WorkflowEvent<GroupCheckoutInput | GroupCheckoutOutput>,
): GroupCheckout => {
  switch (event.type) {
    case 'GroupCheckoutInitiated':
      if (state.status !== 'NotExisting') return state;
      return {
        status: 'Pending',
        guestStayAccountIds: event.data.guestStayAccountIds.reduce(
          (map, id) => map.set(id, 'Pending'),
          new Map<string, GuestStayStatus>(),
        ),
      };

    case 'GuestCheckedOut':
    case 'GuestCheckoutFailed':
      if (state.status !== 'Pending') return state;
      return {
        ...state,
        guestStayAccountIds: state.guestStayAccountIds.set(
          event.data.guestStayAccountId,
          event.type === 'GuestCheckedOut' ? 'Completed' : 'Failed',
        ),
      };

    case 'GroupCheckoutCompleted':
    case 'GroupCheckoutFailed':
      return { status: 'Finished' };

    default:
      return state;
  }
};
```

### Step 5: Compose the Workflow

```typescript
const groupCheckoutWorkflow: Workflow<
  GroupCheckoutInput,
  GroupCheckout,
  GroupCheckoutOutput
> = {
  decide,
  evolve,
  initialState,
};
```

## Workflow Stream Structure

Each workflow instance has its own stream recording all inputs and outputs:

```
Stream: workflow-GroupCheckout-gc-123
Position | Kind    | Type                    | Data
---------|---------|-------------------------|---------------------------
0        | Command | InitiateGroupCheckout   | { guestIds: ['g1', 'g2'] }
1        | Event   | GroupCheckoutInitiated  | { guestIds: ['g1', 'g2'] }
2        | Command | CheckOut                | { guestId: 'g1' }
3        | Command | CheckOut                | { guestId: 'g2' }
4        | Event   | GuestCheckedOut         | { guestId: 'g1' }
5        | Event   | GuestCheckoutFailed     | { guestId: 'g2' }
6        | Event   | GroupCheckoutFailed     | { completed: ['g1'], failed: ['g2'] }
```

## Testing Workflows

Workflows use the same `DeciderSpecification` as Deciders:

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
        data: { groupCheckoutId: 'gc-1', guestStayAccountIds: ['g1', 'g2'] },
      })
      .then([
        {
          type: 'GroupCheckoutInitiated',
          data: expect.objectContaining({ guestStayAccountIds: ['g1', 'g2'] }),
        },
        { type: 'CheckOut', data: { guestStayAccountId: 'g1' } },
        { type: 'CheckOut', data: { guestStayAccountId: 'g2' } },
      ]));

  it('completes when all guests checked out', () =>
    spec([
      {
        type: 'GroupCheckoutInitiated',
        data: { groupCheckoutId: 'gc-1', guestStayAccountIds: ['g1', 'g2'] },
      },
      {
        type: 'GuestCheckedOut',
        data: { guestStayAccountId: 'g1', groupCheckoutId: 'gc-1' },
      },
    ])
      .when({
        type: 'GuestCheckedOut',
        data: { guestStayAccountId: 'g2', groupCheckoutId: 'gc-1' },
      })
      .then([
        {
          type: 'GroupCheckoutCompleted',
          data: expect.objectContaining({
            completedCheckouts: expect.arrayContaining(['g1', 'g2']),
          }),
        },
      ]));
});
```

## Error Recovery

Workflows automatically recover from failures:

1. **Crash during processing**: On restart, replay events to rebuild state
2. **Partial completion**: Resume from last recorded position
3. **External failures**: Record failure events, enable compensation

```typescript
const decide = (input, state) => {
  if (input.type === 'ExternalServiceFailed') {
    return [
      { kind: 'Event', type: 'ProcessingFailed', data: input.data },
      { kind: 'Command', type: 'CompensatePreviousSteps', data: { ... } },
    ];
  }
};
```

## Timeouts

Handle workflows that take too long:

```typescript
type GroupCheckoutInput =
  | /* ... other inputs ... */
  | Command<'TimeoutGroupCheckout', { groupCheckoutId: string }>;

const decide = (input, state) => {
  if (input.type === 'TimeoutGroupCheckout') {
    if (state.status !== 'Pending') return [];

    return [{
      kind: 'Event',
      type: 'GroupCheckoutTimedOut',
      data: {
        groupCheckoutId: input.data.groupCheckoutId,
        pendingGuests: [...state.guestStayAccountIds.entries()]
          .filter(([_, status]) => status === 'Pending')
          .map(([id]) => id),
      },
    }];
  }
};
```

## When to Use Workflows

**Use workflows for:**
- Multi-step processes spanning multiple aggregates
- Long-running operations (hours, days, weeks)
- Processes requiring coordination across services
- Operations needing complete audit trail

**Don't use workflows for:**
- Simple single-aggregate operations → use [Command Handler](/api-reference/commandhandler)
- Building read models → use [Projections](/api-reference/projections)
- Simple event reactions → use Reactors

## Best Practices

### 1. Make Workflows Recoverable

```typescript
// ✅ Good: State allows recovery
type State =
  | { status: 'Processing'; completedSteps: string[] }
  | { status: 'Completed' };

// ❌ Bad: No way to know what's done
type State = { processing: boolean };
```

### 2. Use Events for Internal State, Commands for External

```typescript
// ✅ Good: Emit events for own state, commands for others
return [
  { kind: 'Event', type: 'StepCompleted', data: { step: 1 } },
  { kind: 'Command', type: 'ProcessNextItem', data: { itemId } },
];
```

### 3. Handle Duplicate Messages

```typescript
const decide = (input, state) => {
  // Already processed this guest
  if (state.guestStayAccountIds.get(input.data.guestStayAccountId) !== 'Pending') {
    return [];  // Idempotent: ignore duplicate
  }
  // Process...
};
```

## See Also

- [Workflows Guide](/guides/workflows) - Detailed patterns and examples
- [Decider](/api-reference/decider) - Foundation for workflow logic
- [The Workflow Pattern](https://blog.bittacklr.be/the-workflow-pattern.html) - Background theory
