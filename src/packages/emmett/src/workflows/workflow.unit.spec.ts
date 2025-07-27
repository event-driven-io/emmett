import type { Command } from '../typing/command';
import type { Event } from '../typing/event';
import type {
  Workflow,
  WorkflowEvent,
  WorkflowOutput,
} from '../workflows/workflow';
import { workflowProcessor } from './workflowProcessor';

export type CheckOut = Command<
  'CheckOut',
  {
    guestStayAccountId: string;
    groupCheckoutId?: string;
  }
>;

export type GuestCheckedOut = Event<
  'GuestCheckedOut',
  {
    guestStayAccountId: string;
    checkedOutAt: Date;
    groupCheckoutId?: string;
  }
>;

export type GuestCheckoutFailed = Event<
  'GuestCheckoutFailed',
  {
    guestStayAccountId: string;
    reason: 'NotCheckedIn' | 'BalanceNotSettled';
    failedAt: Date;
    groupCheckoutId?: string;
  }
>;

////////////////////////////////////////////
////////// Commands
///////////////////////////////////////////

export type InitiateGroupCheckout = Command<
  'InitiateGroupCheckout',
  {
    groupCheckoutId: string;
    clerkId: string;
    guestStayAccountIds: string[];
    now: Date;
  }
>;

export type TimeoutGroupCheckout = Command<
  'TimeoutGroupCheckout',
  {
    groupCheckoutId: string;
    startedAt: Date;
    timeOutAt: Date;
  }
>;

////////////////////////////////////////////
////////// EVENTS
///////////////////////////////////////////

export type GroupCheckoutInitiated = Event<
  'GroupCheckoutInitiated',
  {
    groupCheckoutId: string;
    clerkId: string;
    guestStayAccountIds: string[];
    initiatedAt: Date;
  }
>;

export type GroupCheckoutCompleted = Event<
  'GroupCheckoutCompleted',
  {
    groupCheckoutId: string;
    completedCheckouts: string[];
    completedAt: Date;
  }
>;

export type GroupCheckoutFailed = Event<
  'GroupCheckoutFailed',
  {
    groupCheckoutId: string;
    completedCheckouts: string[];
    failedCheckouts: string[];
    failedAt: Date;
  }
>;

export type GroupCheckoutTimedOut = Event<
  'GroupCheckoutTimedOut',
  {
    groupCheckoutId: string;
    incompleteCheckouts: string[];
    completedCheckouts: string[];
    failedCheckouts: string[];
    timedOutAt: Date;
  }
>;

////////////////////////////////////////////
////////// State
///////////////////////////////////////////

export type GroupCheckout =
  | { status: 'NotExisting' }
  | {
      status: 'Pending';
      guestStayAccountIds: Map<string, GuestStayStatus>;
    }
  | { status: 'Finished' };

export const initialState = (): GroupCheckout => {
  return {
    status: 'NotExisting',
  };
};

export enum GuestStayStatus {
  Pending = 'Pending',
  Completed = 'Completed',
  Failed = 'Failed',
}

////////////////////////////////////////////
////////// Workflow Inputs & Outputs
///////////////////////////////////////////

export type GroupCheckoutInput =
  | InitiateGroupCheckout
  | GuestCheckedOut
  | GuestCheckoutFailed
  | TimeoutGroupCheckout;

export type GroupCheckoutOutput =
  | GroupCheckoutInitiated
  | CheckOut
  | GroupCheckoutCompleted
  | GroupCheckoutFailed
  | GroupCheckoutTimedOut;

////////////////////////////////////////////
////////// Evolve
///////////////////////////////////////////

export const evolve = (
  state: GroupCheckout,
  {
    type,
    data: event,
  }: WorkflowEvent<GroupCheckoutInput | GroupCheckoutOutput>,
): GroupCheckout => {
  switch (type) {
    case 'GroupCheckoutInitiated': {
      if (state.status !== 'NotExisting') return state;

      return {
        status: 'Pending',
        guestStayAccountIds: event.guestStayAccountIds.reduce(
          (map, id) => map.set(id, GuestStayStatus.Pending),
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
          event.guestStayAccountId,
          type === 'GuestCheckedOut'
            ? GuestStayStatus.Completed
            : GuestStayStatus.Failed,
        ),
      };
    }
    case 'GroupCheckoutCompleted':
    case 'GroupCheckoutFailed':
    case 'GroupCheckoutTimedOut': {
      if (state.status !== 'Pending') return state;

      return {
        status: 'Finished',
      };
    }
    default: {
      const _notExistingEventType: never = type;
      return state;
    }
  }
};

////////////////////////////////////////////
////////// Decide
///////////////////////////////////////////

export const decide = (
  input: GroupCheckoutInput,
  state: GroupCheckout,
): WorkflowOutput<GroupCheckoutOutput> => {
  const { type } = input;

  switch (type) {
    case 'InitiateGroupCheckout': {
      return initiateGroupCheckout(input, state);
    }
    case 'GuestCheckedOut':
    case 'GuestCheckoutFailed': {
      return completeGroupCheckout(input, state);
    }
    case 'TimeoutGroupCheckout': {
      return timedOut(input, state);
    }
  }
};

////////////////////////////////////////////
////////// Workflow Definition
////////////////////////////////////////////

export const GroupCheckoutWorkflow: Workflow<
  GroupCheckoutInput,
  GroupCheckout,
  GroupCheckoutOutput
> = {
  name: 'GroupCheckoutWorkflow',
  decide,
  evolve,
  initialState,
};

////////////////////////////////////////////
////////// Workflow Processor
////////////////////////////////////////////

export const groupCheckoutWorkflowProcessor = workflowProcessor({
  workflow: GroupCheckoutWorkflow,
  getWorkflowId: (input) => input.data.groupCheckoutId ?? null,
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
});

////////////////////////////////////////////
////////// Logic
///////////////////////////////////////////

const initiateGroupCheckout = (
  { data }: InitiateGroupCheckout,
  state: GroupCheckout,
): [GroupCheckoutInitiated, ...CheckOut[]] | [] => {
  if (state.status !== 'NotExisting') return [];

  const checkoutGuestStays: CheckOut[] = data.guestStayAccountIds.map((id) => ({
    type: 'CheckOut',
    data: {
      guestStayAccountId: id,
      groupCheckoutId: data.groupCheckoutId,
    },
    metadata: {
      now: data.now,
    },
  }));

  return [
    {
      type: 'GroupCheckoutInitiated',
      data: {
        groupCheckoutId: data.groupCheckoutId,
        guestStayAccountIds: data.guestStayAccountIds,
        initiatedAt: data.now,
        clerkId: data.clerkId,
      },
    },
    ...checkoutGuestStays,
  ];
};

const completeGroupCheckout = (
  { type, data }: GuestCheckedOut | GuestCheckoutFailed,
  state: GroupCheckout,
): GroupCheckoutCompleted | GroupCheckoutFailed | [] => {
  if (
    !data.groupCheckoutId ||
    state.status === 'NotExisting' ||
    state.status === 'Finished'
  )
    return [];

  const { guestStayAccountId, groupCheckoutId } = data;

  const guestCheckoutStatus = state.guestStayAccountIds.get(guestStayAccountId);

  if (isAlreadyClosed(guestCheckoutStatus)) return [];

  const guestStayAccountIds = state.guestStayAccountIds.set(
    guestStayAccountId,
    type === 'GuestCheckedOut'
      ? GuestStayStatus.Completed
      : GuestStayStatus.Failed,
  );

  const now = type === 'GuestCheckedOut' ? data.checkedOutAt : data.failedAt;

  return areAnyOngoingCheckouts(guestStayAccountIds)
    ? []
    : finished(groupCheckoutId, state.guestStayAccountIds, now);
};

const timedOut = (
  command: TimeoutGroupCheckout,
  state: GroupCheckout,
): GroupCheckoutTimedOut | [] => {
  if (state.status === 'NotExisting' || state.status === 'Finished') return [];

  return {
    type: 'GroupCheckoutTimedOut',
    data: {
      groupCheckoutId: command.data.groupCheckoutId,
      incompleteCheckouts: checkoutsWith(
        state.guestStayAccountIds,
        GuestStayStatus.Pending,
      ),
      completedCheckouts: checkoutsWith(
        state.guestStayAccountIds,
        GuestStayStatus.Completed,
      ),
      failedCheckouts: checkoutsWith(
        state.guestStayAccountIds,
        GuestStayStatus.Failed,
      ),
      timedOutAt: command.data.timeOutAt,
    },
  };
};

const finished = (
  groupCheckoutId: string,
  guestStayAccounts: Map<string, GuestStayStatus>,
  now: Date,
): GroupCheckoutCompleted | GroupCheckoutFailed => {
  return areAllCompleted(guestStayAccounts)
    ? {
        type: 'GroupCheckoutCompleted',
        data: {
          groupCheckoutId,
          completedCheckouts: Array.from(guestStayAccounts.values()),
          completedAt: now,
        },
      }
    : {
        type: 'GroupCheckoutFailed',
        data: {
          groupCheckoutId,
          completedCheckouts: checkoutsWith(
            guestStayAccounts,
            GuestStayStatus.Completed,
          ),
          failedCheckouts: checkoutsWith(
            guestStayAccounts,
            GuestStayStatus.Failed,
          ),
          failedAt: now,
        },
      };
};

export const isAlreadyClosed = (status: GuestStayStatus | undefined) =>
  status === GuestStayStatus.Completed || status === GuestStayStatus.Failed;

const areAnyOngoingCheckouts = (
  guestStayAccounts: Map<string, GuestStayStatus>,
) => [...guestStayAccounts.values()].some((status) => !isAlreadyClosed(status));

const areAllCompleted = (guestStayAccounts: Map<string, GuestStayStatus>) =>
  [...guestStayAccounts.values()].some(
    (status) => status === GuestStayStatus.Completed,
  );

const checkoutsWith = (
  guestStayAccounts: Map<string, GuestStayStatus>,
  status: GuestStayStatus,
): string[] =>
  [...guestStayAccounts.entries()]
    .filter((s) => s[1] === status)
    .map((s) => s[0]);
