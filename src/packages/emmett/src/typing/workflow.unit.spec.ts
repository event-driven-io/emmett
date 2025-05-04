import type { Command } from './command';
import type { Event } from './event';
import {
  accept,
  complete,
  error,
  ignore,
  publish,
  send,
  type Workflow,
  type WorkflowEvent,
  type WorkflowOutput,
} from './workflow';

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
////////// Entity
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
////////// Workflow Definition
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

export enum IgnoredReason {
  GroupCheckoutAlreadyInitiated = 'GroupCheckoutAlreadyInitiated',
  GuestCheckoutWasNotPartOfGroupCheckout = 'GuestCheckoutWasNotPartOfGroupCheckout',
  GuestCheckoutAlreadyFinished = 'GuestCheckoutAlreadyFinished',
  GroupCheckoutAlreadyFinished = 'GroupCheckoutAlreadyFinished',
  GroupCheckoutDoesNotExist = 'GroupCheckoutDoesNotExist',
}

export type ErrorReason = 'UnknownInputType';

////////////////////////////////////////////
////////// Decide
///////////////////////////////////////////

export const decide = (
  input: GroupCheckoutInput,
  state: GroupCheckout,
): WorkflowOutput<GroupCheckoutOutput>[] => {
  const { type, data } = input;

  switch (type) {
    case 'InitiateGroupCheckout': {
      if (state.status !== 'NotExisting')
        return [ignore(IgnoredReason.GroupCheckoutAlreadyInitiated)];

      const checkoutGuestStays = data.guestStayAccountIds.map((id) => {
        return send<GroupCheckoutOutput>({
          type: 'CheckOut',
          data: {
            guestStayAccountId: id,
            groupCheckoutId: data.groupCheckoutId,
          },
          metadata: {
            now: data.now,
          },
        });
      });

      return [
        ...checkoutGuestStays,
        publish<GroupCheckoutOutput>({
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: data.groupCheckoutId,
            guestStayAccountIds: data.guestStayAccountIds,
            initiatedAt: data.now,
            clerkId: data.clerkId,
          },
        }),
      ];
    }
    case 'GuestCheckedOut':
    case 'GuestCheckoutFailed': {
      if (!data.groupCheckoutId)
        return [ignore(IgnoredReason.GuestCheckoutWasNotPartOfGroupCheckout)];

      if (state.status === 'NotExisting')
        return [ignore(IgnoredReason.GroupCheckoutDoesNotExist)];

      if (state.status === 'Finished')
        return [ignore(IgnoredReason.GuestCheckoutAlreadyFinished)];

      const { guestStayAccountId, groupCheckoutId } = data;

      const guestCheckoutStatus =
        state.guestStayAccountIds.get(guestStayAccountId);

      if (isAlreadyClosed(guestCheckoutStatus))
        return [ignore(IgnoredReason.GuestCheckoutAlreadyFinished)];

      const guestStayAccountIds = state.guestStayAccountIds.set(
        guestStayAccountId,
        type === 'GuestCheckedOut'
          ? GuestStayStatus.Completed
          : GuestStayStatus.Failed,
      );

      const now =
        type === 'GuestCheckedOut' ? data.checkedOutAt : data.failedAt;

      return areAnyOngoingCheckouts(guestStayAccountIds)
        ? [accept()]
        : [
            publish(finished(groupCheckoutId, state.guestStayAccountIds, now)),
            complete(),
          ];
    }
    case 'TimeoutGroupCheckout': {
      if (state.status === 'NotExisting')
        return [ignore(IgnoredReason.GroupCheckoutDoesNotExist)];

      if (state.status === 'Finished')
        return [ignore(IgnoredReason.GroupCheckoutAlreadyFinished)];

      return [
        publish(
          timedOut(
            data.groupCheckoutId,
            state.guestStayAccountIds,
            data.timeOutAt,
          ),
        ),
        complete(),
      ];
    }
    default: {
      const _notExistingEventType: never = type;
      return [error('UnknownInputType')];
    }
  }
};

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

export const GroupCheckoutWorkflow: Workflow<
  GroupCheckoutInput,
  GroupCheckout,
  GroupCheckoutOutput
> = {
  decide,
  evolve,
  initialState,
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

const timedOut = (
  groupCheckoutId: string,
  guestStayAccounts: Map<string, GuestStayStatus>,
  now: Date,
): GroupCheckoutTimedOut => {
  return {
    type: 'GroupCheckoutTimedOut',
    data: {
      groupCheckoutId,
      incompleteCheckouts: checkoutsWith(
        guestStayAccounts,
        GuestStayStatus.Pending,
      ),
      completedCheckouts: checkoutsWith(
        guestStayAccounts,
        GuestStayStatus.Completed,
      ),
      failedCheckouts: checkoutsWith(guestStayAccounts, GuestStayStatus.Failed),
      timedOutAt: now,
    },
  };
};
